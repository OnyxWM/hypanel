import { ServerInstance } from "./ServerInstance.js";
import { ConfigManager } from "../storage/ConfigManager.js";
import { config as appConfig } from "../config/config.js";
import { createServer as createServerInDb, getAllServers, getServer as getServerFromDb, deleteServer as deleteServerFromDb, updateServerStatus, updateServerConfig, insertNotification, pruneNotifications, } from "../database/db.js";
import { logger, logConfigOperation, logWorldConfigOperation, logError } from "../logger/Logger.js";
import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { Installer } from "../installation/Installer.js";
import { createConfigError, createFilesystemError, HypanelError } from "../errors/index.js";
import { getPlayerTracker } from "./PlayerTracker.js";
import { getServerIP } from "../utils/network.js";
import { spawn } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";
const execAsync = promisify(exec);
export class ServerManager extends EventEmitter {
    instances;
    configManager;
    installer;
    playerListPollingInterval = null;
    backupCleanupInterval = null;
    playerTracker = getPlayerTracker();
    cachedServerIP = null;
    constructor() {
        super();
        this.instances = new Map();
        this.configManager = new ConfigManager();
        this.installer = new Installer();
        this.setupInstallerListeners();
        // Recover any interrupted installations before restoring servers
        this.installer.recoverInterruptedInstallations();
        this.restoreServers();
        this.startAutostartServersOnBoot();
        this.startPlayerListPolling();
        this.startBackupCleanup();
    }
    startAutostartServersOnBoot() {
        // Defer a bit to let the daemon finish initializing and installer recovery settle.
        setTimeout(async () => {
            try {
                const servers = getAllServers();
                const targets = servers.filter((s) => s.autostart === true && s.installState === "INSTALLED");
                if (targets.length === 0) {
                    return;
                }
                logger.info(`Autostart: attempting to start ${targets.length} server(s)`);
                for (const s of targets) {
                    try {
                        // Only start if currently offline (either from DB or instance status)
                        const status = this.instances.get(s.id)?.getStatus() ?? s.status;
                        if (status !== "offline") {
                            continue;
                        }
                        await this.startServer(s.id);
                    }
                    catch (err) {
                        logger.warn(`Autostart: failed to start server ${s.id} (${s.name}): ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
            }
            catch (err) {
                logger.warn(`Autostart: failed to enumerate servers: ${err instanceof Error ? err.message : String(err)}`);
            }
        }, 2000);
    }
    getHytaleConfigMaxPlayers(serverId) {
        try {
            const dbServer = getServerFromDb(serverId);
            if (!dbServer)
                return undefined;
            const serverRoot = dbServer.serverRoot || path.join(appConfig.serversDir, serverId);
            const configPath = path.join(serverRoot, "config.json");
            const resolvedPath = path.resolve(configPath);
            const rootPath = path.resolve(serverRoot);
            if (!resolvedPath.startsWith(rootPath)) {
                return undefined;
            }
            if (!fs.existsSync(configPath)) {
                return undefined;
            }
            const raw = fs.readFileSync(configPath, "utf-8");
            const cfg = JSON.parse(raw);
            const maxPlayers = cfg?.MaxPlayers;
            if (typeof maxPlayers === "number" && Number.isFinite(maxPlayers) && maxPlayers > 0) {
                return maxPlayers;
            }
            return undefined;
        }
        catch {
            return undefined;
        }
    }
    notify(input) {
        try {
            const notification = insertNotification({
                id: uuidv4(),
                type: input.type,
                title: input.title,
                message: input.message,
                serverId: input.serverId,
                serverName: input.serverName,
            });
            // Best-effort pruning to keep DB bounded
            try {
                pruneNotifications(1000);
            }
            catch {
                // ignore
            }
            this.emit("notification", notification);
        }
        catch (error) {
            logger.warn(`Failed to record notification (${input.type}) for server ${input.serverId || "n/a"}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    restoreServers() {
        logger.info("Restoring servers from database...");
        const dbServers = getAllServers();
        for (const dbServer of dbServers) {
            try {
                // Use UUID-based directory: serversDir/serverId
                const serverRoot = dbServer.serverRoot && typeof dbServer.serverRoot === "string" && dbServer.serverRoot.trim() !== ""
                    ? dbServer.serverRoot
                    : path.join(appConfig.serversDir, dbServer.id);
                let config = this.configManager.loadConfig(dbServer.id, serverRoot);
                let configWasModified = false;
                // If config was loaded, ensure all required fields are set from database if missing
                if (config) {
                    const expectedPath = path.join(appConfig.serversDir, dbServer.id);
                    // Ensure id is set from dbServer
                    if (!config.id || config.id !== dbServer.id) {
                        config.id = dbServer.id;
                        configWasModified = true;
                    }
                    // Fill in missing required fields from database (but preserve existing valid values)
                    if (!config.name || typeof config.name !== 'string') {
                        config.name = dbServer.name;
                        configWasModified = true;
                    }
                    if (!config.ip || typeof config.ip !== 'string') {
                        config.ip = dbServer.ip;
                        configWasModified = true;
                    }
                    if (!config.port || typeof config.port !== 'number') {
                        config.port = dbServer.port;
                        configWasModified = true;
                    }
                    // Only set maxMemory if it's missing or invalid - preserve existing valid values
                    if (!config.maxMemory || typeof config.maxMemory !== 'number' || config.maxMemory <= 0) {
                        config.maxMemory = dbServer.maxMemory || 1024;
                        configWasModified = true;
                    }
                    if (!config.maxPlayers || typeof config.maxPlayers !== 'number') {
                        config.maxPlayers = dbServer.maxPlayers || 10;
                        configWasModified = true;
                    }
                    // Ensure path is set to UUID-based directory
                    if (!config.path) {
                        logger.debug(`Config loaded but missing path, setting to UUID-based directory: ${expectedPath}`);
                        config.path = expectedPath;
                        configWasModified = true;
                    }
                    else if (config.path !== expectedPath) {
                        // If config has a path that doesn't match UUID-based directory, update it
                        logger.warn(`Config path (${config.path}) doesn't match expected UUID-based path (${expectedPath}) for server ${dbServer.id}, updating`);
                        config.path = expectedPath;
                        configWasModified = true;
                    }
                    // Save config back to disk if we made any changes
                    if (configWasModified) {
                        logger.info(`Saving updated config for server ${dbServer.id} (preserved maxMemory: ${config.maxMemory}MB)`);
                        this.configManager.saveConfig(config);
                    }
                }
                else {
                    // If no config loaded, set expectedPath for later use
                    const expectedPath = path.join(appConfig.serversDir, dbServer.id);
                }
                // If no config exists, try to create one from database data using UUID-based directory
                if (!config) {
                    const uuidBasedPath = path.join(appConfig.serversDir, dbServer.id);
                    logger.info(`No config found, trying UUID-based directory: ${uuidBasedPath}`);
                    // Check if UUID-based directory exists
                    if (fs.existsSync(uuidBasedPath)) {
                        logger.info(`UUID-based server directory exists, creating config from database data`);
                        config = {
                            id: dbServer.id,
                            name: dbServer.name,
                            path: uuidBasedPath,
                            executable: "java",
                            jarFile: "HytaleServer.jar",
                            args: [],
                            env: {},
                            ip: dbServer.ip,
                            port: dbServer.port,
                            maxMemory: dbServer.maxMemory || 1024,
                            maxPlayers: dbServer.maxPlayers || 10,
                            version: dbServer.version,
                        };
                        // Save the newly created config to disk
                        logger.info(`Saving new config for server ${dbServer.id} with maxMemory: ${config.maxMemory}MB`);
                        this.configManager.saveConfig(config);
                        logger.info(`Created config for server ${dbServer.id} from database data using UUID-based directory`);
                    }
                    else {
                        logger.warn(`UUID-based server directory does not exist: ${uuidBasedPath}`);
                    }
                }
                // Only create instance if we have a valid config with all required fields
                if (config && config.path && typeof config.path === 'string' && config.path.trim() !== '') {
                    // Validate required fields before constructing finalConfig
                    if (!config.id || typeof config.id !== 'string') {
                        logger.warn(`Skipping server ${dbServer.id} (${dbServer.name}): config id is invalid (${config.id})`);
                        continue;
                    }
                    if (!config.name || typeof config.name !== 'string') {
                        logger.warn(`Skipping server ${dbServer.id} (${dbServer.name}): config name is invalid (${config.name})`);
                        continue;
                    }
                    if (!config.ip || typeof config.ip !== 'string') {
                        logger.warn(`Skipping server ${dbServer.id} (${dbServer.name}): config ip is invalid (${config.ip})`);
                        continue;
                    }
                    if (!config.port || typeof config.port !== 'number') {
                        logger.warn(`Skipping server ${dbServer.id} (${dbServer.name}): config port is invalid (${config.port})`);
                        continue;
                    }
                    // Create a fresh config object to ensure all fields are properly set
                    const finalConfig = {
                        id: config.id,
                        name: config.name,
                        path: config.path,
                        executable: config.executable || "java",
                        jarFile: config.jarFile || "HytaleServer.jar",
                        assetsPath: config.assetsPath,
                        args: config.args || [],
                        env: config.env || {},
                        ip: config.ip,
                        port: config.port,
                        maxMemory: config.maxMemory || 1024,
                        maxPlayers: config.maxPlayers || 10,
                        version: config.version,
                        sessionToken: config.sessionToken,
                        identityToken: config.identityToken,
                        bindAddress: config.bindAddress || config.ip || "0.0.0.0",
                        backupEnabled: config.backupEnabled,
                        aotCacheEnabled: config.aotCacheEnabled,
                    };
                    const instance = new ServerInstance(finalConfig);
                    this.setupInstanceListeners(instance);
                    this.instances.set(dbServer.id, instance);
                    // Check if process is still running (by checking PID in database)
                    if (dbServer.status === "online") {
                        // Mark as offline - we'll need to manually start servers after daemon restart
                        // This is safer than trying to reattach to processes
                        updateServerStatus(dbServer.id, "offline", null);
                    }
                }
                else {
                    logger.warn(`Skipping server ${dbServer.id} (${dbServer.name}): no valid config or path found`);
                }
            }
            catch (error) {
                logger.error(`Failed to restore server ${dbServer.id} (${dbServer.name}): ${error instanceof Error ? error.message : String(error)}`);
                // Continue with other servers
            }
        }
        logger.info(`Restored ${this.instances.size} server(s) from database`);
    }
    setupInstanceListeners(instance) {
        instance.on("statusChange", (status) => {
            this.emit("serverStatusChange", instance.id, status);
        });
        instance.on("log", (log) => {
            this.emit("serverLog", instance.id, log);
        });
        instance.on("stats", (stats) => {
            this.emit("serverStats", instance.id, stats);
        });
        instance.on("command", (command) => {
            this.emit("serverCommand", instance.id, command);
        });
        instance.on("exit", (code, signal) => {
            logger.warn(`Server ${instance.id} exited with code ${code}, signal ${signal}`);
            this.emit("serverExit", instance.id, code, signal);
        });
        instance.on("error", (error) => {
            logger.error(`Server ${instance.id} error: ${error.message}`);
            this.emit("serverError", instance.id, error);
        });
    }
    setupInstallerListeners() {
        this.installer.on("installProgress", (serverId, progress) => {
            this.emit("serverInstallProgress", serverId, progress);
        });
    }
    async createServer(config) {
        const id = uuidv4();
        // Set Hytale-specific defaults if not provided
        const serverConfig = {
            ...config,
            executable: config.executable || "java",
            jarFile: config.jarFile || "HytaleServer.jar",
            port: config.port || 5520,
            bindAddress: config.bindAddress || config.ip || "0.0.0.0",
            backupEnabled: config.backupEnabled !== undefined ? config.backupEnabled : true,
            aotCacheEnabled: config.aotCacheEnabled !== undefined ? config.aotCacheEnabled : false,
            id,
        };
        // Use UUID-based server directory (serversDir/serverId)
        const fs = await import("fs/promises");
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);
        // Server directory is always UUID-based: serversDir/serverId
        const serverRoot = path.join(appConfig.serversDir, id);
        // Ensure the server directory exists with secure permissions
        await fs.mkdir(serverRoot, { recursive: true, mode: 0o755 });
        // In production, set ownership to hypanel user
        const isDev = process.env.NODE_ENV !== "production";
        if (!isDev) {
            try {
                // Ensure serversDir exists and has correct ownership
                await fs.mkdir(appConfig.serversDir, { recursive: true });
                await execAsync(`chown -R hypanel:hypanel "${appConfig.serversDir}"`);
                await execAsync(`chmod 755 "${serverRoot}"`);
                logger.info(`Set ownership and secure permissions for: ${serverRoot}`);
            }
            catch (error) {
                logger.warn(`Failed to set ownership for ${serverRoot}: ${error}`);
            }
        }
        // Update server config to use UUID-based path
        serverConfig.path = serverRoot;
        logger.info(`Created server directory: ${serverRoot}`);
        // Create backup folder if backups are enabled
        if (serverConfig.backupEnabled) {
            const backupDir = appConfig.backupDir;
            // Ensure backup directory exists
            await fs.mkdir(backupDir, { recursive: true, mode: 0o755 });
            // Create server-specific backup folder: {backupDir}/{serverId}-back
            const serverBackupDir = path.join(backupDir, `${id}-back`);
            await fs.mkdir(serverBackupDir, { recursive: true, mode: 0o755 });
            logger.info(`Created backup directory: ${serverBackupDir}`);
            // In production, set ownership to hypanel user
            if (!isDev) {
                try {
                    await execAsync(`chown -R hypanel:hypanel "${serverBackupDir}"`);
                    await execAsync(`chmod 755 "${serverBackupDir}"`);
                    logger.info(`Set ownership and secure permissions for backup directory: ${serverBackupDir}`);
                }
                catch (error) {
                    logger.warn(`Failed to set ownership for backup directory ${serverBackupDir}: ${error}`);
                }
            }
        }
        // Save config to filesystem
        this.configManager.saveConfig(serverConfig);
        // Create server in database with UUID-based server root
        const now = new Date().toISOString();
        createServerInDb({
            id,
            name: config.name,
            status: "offline",
            ip: config.ip,
            port: config.port,
            version: config.version || "",
            createdAt: now,
            maxPlayers: config.maxPlayers,
            maxMemory: config.maxMemory,
            installState: "NOT_INSTALLED",
            serverRoot, // UUID-based path: serversDir/serverId
            autostart: Boolean(config.autostart),
        });
        // Create server instance
        const instance = new ServerInstance(serverConfig);
        this.setupInstanceListeners(instance);
        this.instances.set(id, instance);
        logger.info(`Created server: ${id} (${config.name})`);
        this.notify({
            type: "server.created",
            title: "Server created",
            message: `Server "${config.name}" was created`,
            serverId: id,
            serverName: config.name,
        });
        return this.getServer(id);
    }
    async updateServerConfig(id, config) {
        logConfigOperation(id, "validation", "Starting server config update");
        const instance = this.instances.get(id);
        if (!instance) {
            const error = createConfigError("update", "Server not found", id);
            logError(error, "config", id);
            throw error;
        }
        try {
            // Update database
            logConfigOperation(id, "database", "Updating server configuration in database");
            updateServerConfig(id, config);
            // Update config in filesystem
            const currentConfig = instance.config;
            // Only write config fields that belong in the on-disk config.json.
            // `autostart` is stored in the database only.
            const { autostart: _autostart, ...fsConfig } = config;
            const updatedConfig = { ...currentConfig, ...fsConfig };
            logConfigOperation(id, "filesystem", "Saving server config to filesystem");
            this.configManager.saveConfig(updatedConfig);
            // Update instance config
            instance.config = updatedConfig;
            logConfigOperation(id, "complete", "Server configuration updated successfully", {
                updatedFields: Object.keys(config)
            });
            return this.getServer(id);
        }
        catch (error) {
            const structuredError = createConfigError("update", error instanceof Error ? error.message : "Unknown error", id, "Check file permissions and database connectivity");
            logError(structuredError, "config", id);
            throw structuredError;
        }
    }
    async deleteServer(id) {
        // First check if server exists in database
        const dbServer = getServerFromDb(id);
        if (!dbServer) {
            throw new Error(`Server ${id} not found in database`);
        }
        const instance = this.instances.get(id);
        // Get server root path from database or instance
        const serverRoot = dbServer.serverRoot || instance?.config.path;
        // Stop server if running (only if instance exists)
        if (instance) {
            if (instance.getStatus() !== "offline") {
                await instance.stop(true);
            }
            // Remove instance
            this.instances.delete(id);
            instance.destroy();
        }
        // Delete from database
        deleteServerFromDb(id);
        // Delete config from filesystem
        this.configManager.deleteConfig(id);
        // Delete server root directory (only the server directory, nothing else)
        if (serverRoot) {
            // Verify the path is within the expected hypanel directory before deletion
            const resolvedRoot = path.resolve(serverRoot);
            const isDev = process.env.NODE_ENV !== "production";
            const expectedBase = isDev
                ? path.resolve(appConfig.serversDir)
                : path.resolve("/home/hypanel/hytale");
            if (resolvedRoot.startsWith(expectedBase)) {
                try {
                    if (fs.existsSync(serverRoot)) {
                        fs.rmSync(serverRoot, { recursive: true, force: true });
                        logger.info(`Deleted server directory: ${serverRoot}`);
                    }
                }
                catch (error) {
                    logger.error(`Failed to delete server directory ${serverRoot}: ${error}`);
                }
            }
            else {
                logger.warn(`Skipping deletion of server directory ${serverRoot} - outside expected base path`);
            }
        }
        else {
            logger.warn(`No server root path found for server ${id}, skipping directory deletion`);
        }
        logger.info(`Deleted server: ${id}`);
    }
    async startServer(id) {
        let instance = this.instances.get(id);
        // If instance doesn't exist, try to restore it
        if (!instance) {
            logger.info(`Server instance not found for ${id}, attempting to restore...`);
            const dbServer = getServerFromDb(id);
            if (!dbServer) {
                logger.error(`Server ${id} not found in database`);
                throw new Error(`Server ${id} not found in database`);
            }
            logger.info(`Found server in database: ${dbServer.name}, serverRoot: ${dbServer.serverRoot || 'none'}`);
            // Use UUID-based directory: serversDir/serverId
            // If serverRoot exists in DB, use it (for backward compatibility), otherwise construct from UUID
            const serverRoot = dbServer.serverRoot && typeof dbServer.serverRoot === "string" && dbServer.serverRoot.trim() !== ""
                ? dbServer.serverRoot
                : path.join(appConfig.serversDir, id);
            logger.info(`Attempting to load config for server ${id}, serverRoot: ${serverRoot}`);
            // Load config using UUID-based path
            let config = this.configManager.loadConfig(id, serverRoot);
            logger.info(`Config load result: ${config ? 'found' : 'not found'}`);
            if (!config) {
                logger.warn(`Config file not found at expected location: ${path.join(serverRoot, 'config.json')}`);
            }
            // If config was loaded but doesn't have a path, use UUID-based directory
            if (config && !config.path) {
                logger.info(`Config loaded but missing path field, setting path to UUID-based directory: ${serverRoot}`);
                config = {
                    ...config,
                    id: id, // Ensure id is set from serverId parameter
                    path: serverRoot,
                };
            }
            else if (config && config.path && config.path !== serverRoot) {
                // If config has a path that doesn't match, update it to use UUID-based directory
                logger.warn(`Config path (${config.path}) doesn't match expected UUID-based path (${serverRoot}), updating`);
                config = {
                    ...config,
                    id: id, // Ensure id is set from serverId parameter
                    path: serverRoot,
                };
            }
            else if (config && (!config.id || config.id !== id)) {
                // Ensure id is set from serverId parameter if missing or mismatched
                logger.info(`Config loaded but id is missing or mismatched, setting id to serverId: ${id}`);
                config = {
                    ...config,
                    id: id,
                };
            }
            // If no config exists, try to create one from database data using UUID-based directory
            if (!config) {
                logger.info(`No config found, attempting to create from database data using UUID-based directory...`);
                const uuidBasedPath = path.join(appConfig.serversDir, id);
                logger.info(`Checking if UUID-based directory exists: ${uuidBasedPath}`);
                if (fs.existsSync(uuidBasedPath)) {
                    logger.info(`UUID-based server directory exists, creating config from database data`);
                    config = {
                        id: dbServer.id,
                        name: dbServer.name,
                        path: uuidBasedPath,
                        executable: "java",
                        jarFile: "HytaleServer.jar",
                        args: [],
                        env: {},
                        ip: dbServer.ip,
                        port: dbServer.port,
                        maxMemory: dbServer.maxMemory || 1024,
                        maxPlayers: dbServer.maxPlayers || 10,
                        version: dbServer.version,
                    };
                    logger.info(`Created config for server ${id} from database data using UUID-based directory`);
                }
                else {
                    logger.warn(`UUID-based server directory does not exist: ${uuidBasedPath}`);
                }
            }
            // Ensure path is set - use UUID-based directory (serversDir/serverId)
            const expectedPath = path.join(appConfig.serversDir, id);
            if (config && !config.path) {
                logger.info(`Setting config path to UUID-based directory: ${expectedPath}`);
                config = { ...config, path: expectedPath };
            }
            else if (config && config.path && config.path !== expectedPath) {
                // If config has a path that doesn't match UUID-based directory, update it
                logger.warn(`Config path (${config.path}) doesn't match expected UUID-based path (${expectedPath}), updating`);
                config = { ...config, path: expectedPath };
            }
            if (!config || !config.path || typeof config.path !== 'string' || config.path.trim() === '') {
                logger.error(`Server ${id} configuration not found or invalid path. Config exists: ${!!config}, path type: ${typeof config?.path}, path value: ${config?.path || 'none'}, serverRoot: ${serverRoot || 'none'}, oldDir: ${path.join(appConfig.serversDir, id)}`);
                throw new Error(`Server ${id} configuration not found or invalid. Please reinstall the server.`);
            }
            logger.info(`Config validated: path=${config.path}, path type: ${typeof config.path}`);
            // Validate required fields before constructing finalConfig
            if (!config.id || typeof config.id !== 'string') {
                logger.error(`Config validation failed: id is invalid. id=${config.id}, type=${typeof config.id}`);
                throw new Error(`Server ${id} configuration id is invalid. Please reinstall the server.`);
            }
            if (!config.name || typeof config.name !== 'string') {
                logger.error(`Config validation failed: name is invalid. name=${config.name}, type=${typeof config.name}`);
                throw new Error(`Server ${id} configuration name is invalid. Please reinstall the server.`);
            }
            if (!config.ip || typeof config.ip !== 'string') {
                logger.error(`Config validation failed: ip is invalid. ip=${config.ip}, type=${typeof config.ip}`);
                throw new Error(`Server ${id} configuration ip is invalid. Please reinstall the server.`);
            }
            if (!config.port || typeof config.port !== 'number') {
                logger.error(`Config validation failed: port is invalid. port=${config.port}, type=${typeof config.port}`);
                throw new Error(`Server ${id} configuration port is invalid. Please reinstall the server.`);
            }
            // Create a fresh config object with all required fields to avoid any reference issues
            const finalConfig = {
                id: config.id,
                name: config.name,
                path: config.path, // Explicitly ensure path is set
                executable: config.executable || "java",
                jarFile: config.jarFile || "HytaleServer.jar",
                assetsPath: config.assetsPath,
                args: config.args || [],
                env: config.env || {},
                ip: config.ip,
                port: config.port,
                maxMemory: config.maxMemory || 1024,
                maxPlayers: config.maxPlayers || 10,
                version: config.version,
                sessionToken: config.sessionToken,
                identityToken: config.identityToken,
                bindAddress: config.bindAddress || config.ip || "0.0.0.0",
                backupEnabled: config.backupEnabled,
                aotCacheEnabled: config.aotCacheEnabled,
            };
            // Double-check path is still valid
            if (!finalConfig.path || typeof finalConfig.path !== 'string' || finalConfig.path.trim() === '') {
                logger.error(`Final config validation failed: path is invalid. path=${finalConfig.path}, type=${typeof finalConfig.path}`);
                throw new Error(`Server ${id} configuration path is invalid after construction. Please reinstall the server.`);
            }
            // Validate all required string fields are defined
            if (!finalConfig.id || !finalConfig.name || !finalConfig.ip || typeof finalConfig.port !== 'number') {
                logger.error(`Final config validation failed: required fields missing. id=${finalConfig.id}, name=${finalConfig.name}, ip=${finalConfig.ip}, port=${finalConfig.port}`);
                throw new Error(`Server ${id} configuration has missing required fields. Please reinstall the server.`);
            }
            logger.info(`Creating server instance with config path: ${finalConfig.path}`);
            // Validate appConfig.serversDir is defined (used in path operations)
            if (!appConfig.serversDir || typeof appConfig.serversDir !== 'string') {
                logger.error(`appConfig.serversDir is invalid: ${appConfig.serversDir}, type: ${typeof appConfig.serversDir}`);
                throw new Error(`Application configuration serversDir is invalid. This is a system configuration error.`);
            }
            try {
                // Create and register the instance with the fresh config object
                // Ensure id is defined before creating instance (used in logger initialization)
                if (!finalConfig.id || typeof finalConfig.id !== 'string') {
                    logger.error(`Cannot create ServerInstance: id is invalid. id=${finalConfig.id}, type=${typeof finalConfig.id}`);
                    throw new Error(`Server ${id} configuration id is invalid. Please reinstall the server.`);
                }
                instance = new ServerInstance(finalConfig);
                logger.info(`ServerInstance created for ${id}`);
                this.setupInstanceListeners(instance);
                logger.info(`Instance listeners setup for ${id}`);
                this.instances.set(id, instance);
                logger.info(`Restored server instance for ${id} and added to instances map`);
            }
            catch (error) {
                logger.error(`Failed to create server instance for ${id}: ${error instanceof Error ? error.message : String(error)}`);
                if (error instanceof Error && error.stack) {
                    logger.error(`Error stack: ${error.stack}`);
                }
                logger.error(`Config object at error time: ${JSON.stringify(finalConfig, null, 2)}`);
                logger.error(`appConfig.serversDir: ${appConfig.serversDir}, type: ${typeof appConfig.serversDir}`);
                throw error;
            }
        }
        logger.info(`Starting server ${id}...`);
        try {
            await instance.start();
            logger.info(`Server ${id} start completed successfully`);
            const dbServer = getServerFromDb(id);
            this.notify({
                type: "server.started",
                title: "Server started",
                message: `Server "${dbServer?.name || id}" started`,
                serverId: id,
                serverName: dbServer?.name,
            });
        }
        catch (error) {
            logger.error(`Failed to start server ${id}: ${error instanceof Error ? error.message : String(error)}`);
            const dbServer = getServerFromDb(id);
            this.notify({
                type: "server.start_failed",
                title: "Server failed to start",
                message: `Server "${dbServer?.name || id}" failed to start: ${error instanceof Error ? error.message : String(error)}`,
                serverId: id,
                serverName: dbServer?.name,
            });
            throw error;
        }
    }
    async stopServer(id, force = false) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Server ${id} not found`);
        }
        try {
            await instance.stop(force);
            const dbServer = getServerFromDb(id);
            this.notify({
                type: "server.stopped",
                title: "Server stopped",
                message: `Server "${dbServer?.name || id}" stopped`,
                serverId: id,
                serverName: dbServer?.name,
            });
        }
        catch (error) {
            const dbServer = getServerFromDb(id);
            this.notify({
                type: "server.stop_failed",
                title: "Server failed to stop",
                message: `Server "${dbServer?.name || id}" failed to stop: ${error instanceof Error ? error.message : String(error)}`,
                serverId: id,
                serverName: dbServer?.name,
            });
            throw error;
        }
    }
    async restartServer(id) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Server ${id} not found`);
        }
        try {
            await instance.restart();
            const dbServer = getServerFromDb(id);
            this.notify({
                type: "server.restarted",
                title: "Server restarted",
                message: `Server "${dbServer?.name || id}" restarted`,
                serverId: id,
                serverName: dbServer?.name,
            });
        }
        catch (error) {
            const dbServer = getServerFromDb(id);
            this.notify({
                type: "server.restart_failed",
                title: "Server failed to restart",
                message: `Server "${dbServer?.name || id}" failed to restart: ${error instanceof Error ? error.message : String(error)}`,
                serverId: id,
                serverName: dbServer?.name,
            });
            throw error;
        }
    }
    async installServer(id) {
        const dbServer = getServerFromDb(id);
        logger.info(`Starting installation for server ${id}`);
        this.notify({
            type: "server.install_started",
            title: "Installation started",
            message: `Installation started for "${dbServer?.name || id}"`,
            serverId: id,
            serverName: dbServer?.name,
        });
        try {
            await this.installer.installServer(id);
            this.notify({
                type: "server.installed",
                title: "Installation completed",
                message: `Installation completed for "${dbServer?.name || id}"`,
                serverId: id,
                serverName: dbServer?.name,
            });
        }
        catch (error) {
            this.notify({
                type: "server.install_failed",
                title: "Installation failed",
                message: `Installation failed for "${dbServer?.name || id}": ${error instanceof Error ? error.message : String(error)}`,
                serverId: id,
                serverName: dbServer?.name,
            });
            throw error;
        }
    }
    sendCommand(id, command) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Server ${id} not found`);
        }
        instance.sendCommand(command);
    }
    getServerInstance(id) {
        return this.instances.get(id);
    }
    getServer(id) {
        const instance = this.instances.get(id);
        const dbServer = getServerFromDb(id);
        if (!dbServer) {
            return null;
        }
        const hytaleMaxPlayers = this.getHytaleConfigMaxPlayers(id);
        const actualServerIP = this.getActualServerIP();
        // If no instance exists, try to load config to get maxMemory
        let maxMemory = dbServer.maxMemory || 0;
        let maxPlayers = dbServer.maxPlayers || 0;
        let backupEnabled = undefined;
        let aotCacheEnabled = undefined;
        if (!instance) {
            try {
                const serverRoot = dbServer.serverRoot && typeof dbServer.serverRoot === "string" && dbServer.serverRoot.trim() !== ""
                    ? dbServer.serverRoot
                    : undefined;
                const config = this.configManager.loadConfig(id, serverRoot);
                if (config) {
                    maxMemory = config.maxMemory || 0;
                    maxPlayers = config.maxPlayers || 0;
                    backupEnabled = config.backupEnabled;
                    aotCacheEnabled = config.aotCacheEnabled;
                }
            }
            catch (error) {
                // Config might not exist, use default
                logger.debug(`Could not load config for server ${id}: ${error}`);
            }
            return {
                ...dbServer,
                status: dbServer.status,
                cpu: dbServer.status === "online" ? dbServer.cpu : 0,
                memory: dbServer.status === "online" ? dbServer.memory : 0,
                players: dbServer.status === "online" ? dbServer.players : 0,
                maxMemory,
                maxPlayers: hytaleMaxPlayers ?? maxPlayers,
                backupEnabled,
                aotCacheEnabled,
                uptime: 0,
                // Replace "0.0.0.0" with actual server IP for display
                ip: dbServer.ip === "0.0.0.0" ? actualServerIP : dbServer.ip,
            };
        }
        // Merge instance data with database data
        const process = instance.getProcess();
        const uptime = process.startTime
            ? Math.floor((Date.now() - process.startTime) / 1000)
            : 0;
        const config = instance.config;
        const status = instance.getStatus();
        return {
            ...dbServer,
            status,
            maxMemory: config.maxMemory,
            maxPlayers: hytaleMaxPlayers ?? config.maxPlayers,
            backupEnabled: config.backupEnabled,
            aotCacheEnabled: config.aotCacheEnabled,
            uptime,
            // Clear stats if server is offline
            cpu: status === "online" ? dbServer.cpu : 0,
            memory: status === "online" ? dbServer.memory : 0,
            players: status === "online" ? dbServer.players : 0,
            // Replace "0.0.0.0" with actual server IP for display
            ip: dbServer.ip === "0.0.0.0" ? actualServerIP : dbServer.ip,
        };
    }
    /**
     * Gets the server's actual IP address, with caching.
     * The IP is cached since it doesn't change frequently.
     */
    getActualServerIP() {
        if (this.cachedServerIP === null) {
            this.cachedServerIP = getServerIP();
        }
        return this.cachedServerIP;
    }
    getAllServers() {
        const dbServers = getAllServers();
        const actualServerIP = this.getActualServerIP();
        return dbServers.map((dbServer) => {
            const instance = this.instances.get(dbServer.id);
            const hytaleMaxPlayers = this.getHytaleConfigMaxPlayers(dbServer.id);
            // If no instance exists, try to load config to get maxMemory
            if (!instance) {
                let maxMemory = dbServer.maxMemory || 0;
                let maxPlayers = dbServer.maxPlayers || 0;
                let backupEnabled = undefined;
                let aotCacheEnabled = undefined;
                try {
                    const serverRoot = dbServer.serverRoot && typeof dbServer.serverRoot === "string" && dbServer.serverRoot.trim() !== ""
                        ? dbServer.serverRoot
                        : undefined;
                    const config = this.configManager.loadConfig(dbServer.id, serverRoot);
                    if (config) {
                        maxMemory = config.maxMemory || 0;
                        maxPlayers = config.maxPlayers || 0;
                        backupEnabled = config.backupEnabled;
                        aotCacheEnabled = config.aotCacheEnabled;
                    }
                }
                catch (error) {
                    // Config might not exist, use default
                    logger.debug(`Could not load config for server ${dbServer.id}: ${error}`);
                }
                return {
                    ...dbServer,
                    status: dbServer.status,
                    cpu: dbServer.status === "online" ? dbServer.cpu : 0,
                    memory: dbServer.status === "online" ? dbServer.memory : 0,
                    players: dbServer.status === "online" ? dbServer.players : 0,
                    maxMemory,
                    maxPlayers: hytaleMaxPlayers ?? maxPlayers,
                    backupEnabled,
                    aotCacheEnabled,
                    uptime: 0,
                    // Replace "0.0.0.0" with actual server IP for display
                    ip: dbServer.ip === "0.0.0.0" ? actualServerIP : dbServer.ip,
                };
            }
            const process = instance.getProcess();
            const uptime = process.startTime
                ? Math.floor((Date.now() - process.startTime) / 1000)
                : 0;
            const config = instance.config;
            const status = instance.getStatus();
            return {
                ...dbServer,
                status,
                maxMemory: config.maxMemory,
                maxPlayers: hytaleMaxPlayers ?? config.maxPlayers,
                backupEnabled: config.backupEnabled,
                aotCacheEnabled: config.aotCacheEnabled,
                uptime,
                // Clear stats if server is offline
                cpu: status === "online" ? dbServer.cpu : 0,
                memory: status === "online" ? dbServer.memory : 0,
                players: status === "online" ? dbServer.players : 0,
                // Replace "0.0.0.0" with actual server IP for display
                ip: dbServer.ip === "0.0.0.0" ? actualServerIP : dbServer.ip,
            };
        });
    }
    getInstance(id) {
        return this.instances.get(id);
    }
    /**
     * Sanitize a path component to prevent directory traversal attacks
     */
    sanitizePathComponent(component) {
        // Remove any path separators, parent directory references, and special characters
        return component.replace(/[\/\\:.]/g, '_').replace(/\.\./g, '');
    }
    /**
     * Sanitize a server name for filesystem use
     * Converts server name to a filesystem-safe format
     */
    sanitizeServerName(name) {
        if (!name || name.trim().length === 0) {
            return '';
        }
        // Trim whitespace and collapse multiple spaces
        let sanitized = name.trim().replace(/\s+/g, ' ');
        // Replace invalid filesystem characters with underscores
        // Invalid chars: / \ : * ? " < > |
        sanitized = sanitized.replace(/[\/\\:*?"<>|]/g, '_');
        // Remove any remaining path traversal attempts
        sanitized = sanitized.replace(/\.\./g, '');
        // Limit length to filesystem-safe limit (255 chars for most filesystems)
        // Leave some room for potential UUID suffix in collision cases
        const maxLength = 200;
        if (sanitized.length > maxLength) {
            sanitized = sanitized.substring(0, maxLength);
        }
        // Remove leading/trailing dots and spaces (Windows filesystem restriction)
        sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');
        // If after sanitization we have an empty string, return empty (will use UUID fallback)
        return sanitized;
    }
    /**
     * Get a unique server directory path, handling name collisions
     * If the sanitized name already exists, appends UUID to ensure uniqueness
     */
    async getUniqueServerDirectory(baseDir, sanitizedName, serverId) {
        const fs = await import("fs/promises");
        // If sanitized name is empty, fall back to UUID
        if (!sanitizedName || sanitizedName.length === 0) {
            return path.join(baseDir, serverId);
        }
        // Try the sanitized name first
        let candidatePath = path.join(baseDir, sanitizedName);
        try {
            // Check if directory already exists
            await fs.access(candidatePath);
            // Directory exists - append UUID to make it unique
            logger.info(`Server directory name collision detected: ${sanitizedName}, appending UUID`);
            candidatePath = path.join(baseDir, `${sanitizedName}-${serverId}`);
        }
        catch {
            // Directory doesn't exist - we can use the sanitized name
            // This is the expected case for new servers
        }
        return candidatePath;
    }
    getServerConfig(id) {
        logConfigOperation(id, "validation", "Reading server config");
        const dbServer = getServerFromDb(id);
        if (!dbServer) {
            const error = createConfigError("read", "Server not found in database", id);
            logError(error, "config", id);
            throw error;
        }
        // Use serverRoot from DB if available, otherwise construct UUID-based path
        const serverRoot = dbServer.serverRoot || path.join(appConfig.serversDir, id);
        const configPath = path.join(serverRoot, "config.json");
        // Verify the resolved path stays within the server root
        const resolvedPath = path.resolve(configPath);
        const rootPath = path.resolve(serverRoot);
        if (!resolvedPath.startsWith(rootPath)) {
            const error = createFilesystemError("access", configPath, "Path traversal attempt detected", id);
            logError(error, "config", id);
            throw error;
        }
        if (!fs.existsSync(configPath)) {
            // Create default config.json if it doesn't exist
            logConfigOperation(id, "creating", "Creating default server config.json");
            const defaultConfig = {
                Version: 3,
                ServerName: dbServer.name || "Hytale Server",
                MOTD: "",
                Password: "",
                MaxPlayers: dbServer.maxPlayers || 100,
                MaxViewRadius: 32,
                LocalCompressionEnabled: false,
                Defaults: {
                    World: "default",
                    GameMode: "Adventure"
                },
                ConnectionTimeouts: {
                    JoinTimeouts: {}
                },
                RateLimit: {},
                Modules: {
                    PathPlugin: {
                        Modules: {}
                    }
                },
                LogLevels: {},
                Mods: {},
                DisplayTmpTagsInStrings: false,
                PlayerStorage: {
                    Type: "Hytale"
                },
                AuthCredentialStore: {
                    Type: "Encrypted",
                    Path: "auth.enc"
                }
            };
            // Ensure server directory exists
            if (!fs.existsSync(serverRoot)) {
                fs.mkdirSync(serverRoot, { recursive: true, mode: 0o755 });
            }
            // Write default config
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
            fs.chmodSync(configPath, 0o644);
            logConfigOperation(id, "complete", "Default server config created successfully");
            return defaultConfig;
        }
        try {
            logConfigOperation(id, "loading", "Reading server config file");
            const configContent = fs.readFileSync(configPath, "utf-8");
            const config = JSON.parse(configContent);
            logConfigOperation(id, "complete", "Server config loaded successfully");
            return config;
        }
        catch (parseError) {
            const error = createConfigError("parse", parseError instanceof Error ? parseError.message : "Invalid JSON", id, "Check the config.json file for valid JSON syntax");
            logError(error, "config", id);
            throw error;
        }
    }
    updateHytaleServerConfig(id, updates) {
        logConfigOperation(id, "validation", "Starting server config update");
        const dbServer = getServerFromDb(id);
        if (!dbServer) {
            const error = createConfigError("write", "Server not found in database", id);
            logError(error, "config", id);
            throw error;
        }
        // Check if server is running - don't allow config changes while running
        const instance = this.instances.get(id);
        if (instance && instance.getStatus() === "online") {
            const error = createConfigError("write", "Server is currently running", id, "Stop the server before modifying configuration");
            logError(error, "config", id);
            throw error;
        }
        // Use serverRoot from DB if available, otherwise construct UUID-based path
        const serverRoot = dbServer.serverRoot || path.join(appConfig.serversDir, id);
        const configPath = path.join(serverRoot, "config.json");
        // Verify the resolved path stays within the server root
        const resolvedPath = path.resolve(configPath);
        const rootPath = path.resolve(serverRoot);
        if (!resolvedPath.startsWith(rootPath)) {
            const error = createFilesystemError("access", configPath, "Path traversal attempt detected", id);
            logError(error, "config", id);
            throw error;
        }
        if (!fs.existsSync(configPath)) {
            const error = createConfigError("write", `Server config.json does not exist`, id, "Verify the server has been initialized");
            logError(error, "config", id);
            throw error;
        }
        try {
            // Load existing config to merge with updates
            logConfigOperation(id, "loading", "Loading existing server config");
            const existingContent = fs.readFileSync(configPath, "utf-8");
            const existingConfig = JSON.parse(existingContent);
            // Merge updates with existing config
            const updatedConfig = { ...existingConfig, ...updates };
            // Write to temporary file first, then rename to prevent corruption
            logConfigOperation(id, "saving", "Saving updated server config");
            const configContent = JSON.stringify(updatedConfig, null, 2);
            const tempPath = configPath + ".tmp";
            fs.writeFileSync(tempPath, configContent, "utf-8");
            fs.renameSync(tempPath, configPath);
            logConfigOperation(id, "complete", "Server config updated successfully", {
                updatedFields: Object.keys(updates)
            });
            return updatedConfig;
        }
        catch (error) {
            const structuredError = createConfigError("write", error instanceof Error ? error.message : "Unknown error", id, "Check file permissions and disk space");
            logError(structuredError, "config", id);
            throw structuredError;
        }
    }
    getWorlds(id) {
        const dbServer = getServerFromDb(id);
        if (!dbServer) {
            throw new Error(`Server ${id} not found in database`);
        }
        // Use serverRoot from DB if available, otherwise construct UUID-based path
        const serverRoot = dbServer.serverRoot || path.join(appConfig.serversDir, id);
        const worldsDir = path.join(serverRoot, "universe", "worlds");
        if (!fs.existsSync(worldsDir)) {
            return [];
        }
        try {
            return fs.readdirSync(worldsDir, { withFileTypes: true })
                .filter((dirent) => dirent.isDirectory())
                .map((dirent) => dirent.name);
        }
        catch (error) {
            logger.error(`Failed to read worlds directory for server ${id}: ${error}`);
            return [];
        }
    }
    getWorldConfig(id, world) {
        logWorldConfigOperation(id, world, "validation", "Reading world config");
        const dbServer = getServerFromDb(id);
        if (!dbServer) {
            const error = createConfigError("read", "Server not found in database", id);
            logError(error, "world-config", id);
            throw error;
        }
        // Sanitize world name to prevent path traversal
        const sanitizedWorld = this.sanitizePathComponent(world);
        // Use serverRoot from DB if available, otherwise construct UUID-based path
        const serverRoot = dbServer.serverRoot || path.join(appConfig.serversDir, id);
        const configPath = path.join(serverRoot, "universe", "worlds", sanitizedWorld, "config.json");
        // Verify the resolved path stays within the server root
        const resolvedPath = path.resolve(configPath);
        const rootPath = path.resolve(serverRoot);
        if (!resolvedPath.startsWith(rootPath)) {
            const error = createFilesystemError("access", configPath, "Path traversal attempt detected", id);
            logError(error, "world-config", id, { worldName: world });
            throw error;
        }
        if (!fs.existsSync(configPath)) {
            const error = createConfigError("read", `World ${world} not found or config.json does not exist`, id, "Verify the world exists and has been initialized by the server");
            logError(error, "world-config", id, { worldName: world });
            throw error;
        }
        try {
            logWorldConfigOperation(id, world, "loading", "Reading world config file");
            const configContent = fs.readFileSync(configPath, "utf-8");
            const config = JSON.parse(configContent);
            logWorldConfigOperation(id, world, "complete", "World config loaded successfully");
            return config;
        }
        catch (parseError) {
            const error = createConfigError("parse", parseError instanceof Error ? parseError.message : "Invalid JSON", id, "Check the config.json file for valid JSON syntax");
            logError(error, "world-config", id, { worldName: world });
            throw error;
        }
    }
    updateWorldConfig(id, world, updates) {
        logWorldConfigOperation(id, world, "validation", "Starting world config update");
        const dbServer = getServerFromDb(id);
        if (!dbServer) {
            const error = createConfigError("write", "Server not found in database", id);
            logError(error, "world-config", id);
            throw error;
        }
        // Check if server is running - use instance status if available, otherwise use database status
        const instance = this.instances.get(id);
        const serverStatus = instance ? instance.getStatus() : dbServer.status;
        if (serverStatus === "online" || serverStatus === "starting") {
            const error = createConfigError("write", "Cannot modify world config while server is running", id, "Stop the server first before modifying world configuration");
            logError(error, "world-config", id);
            throw error;
        }
        // Sanitize world name to prevent path traversal
        const sanitizedWorld = this.sanitizePathComponent(world);
        // Use serverRoot from DB if available, otherwise construct UUID-based path
        const serverRoot = dbServer.serverRoot || path.join(appConfig.serversDir, id);
        const configPath = path.join(serverRoot, "universe", "worlds", sanitizedWorld, "config.json");
        // Verify the resolved path stays within the server root
        const resolvedPath = path.resolve(configPath);
        const rootPath = path.resolve(serverRoot);
        if (!resolvedPath.startsWith(rootPath)) {
            const error = createFilesystemError("access", configPath, "Path traversal attempt detected", id);
            logError(error, "world-config", id, { worldName: world });
            throw error;
        }
        if (!fs.existsSync(configPath)) {
            const error = createConfigError("write", `World ${world} not found or config.json does not exist`, id, "Verify the world exists and has been initialized by the server");
            logError(error, "world-config", id, { worldName: world });
            throw error;
        }
        try {
            // Load existing config to merge with updates
            logWorldConfigOperation(id, world, "loading", "Loading existing world config");
            const existingContent = fs.readFileSync(configPath, "utf-8");
            const existingConfig = JSON.parse(existingContent);
            // Merge updates with existing config
            const updatedConfig = { ...existingConfig, ...updates };
            // Write to temporary file first, then rename to prevent corruption
            logWorldConfigOperation(id, world, "saving", "Saving updated world config");
            const configContent = JSON.stringify(updatedConfig, null, 2);
            const tempPath = configPath + ".tmp";
            fs.writeFileSync(tempPath, configContent, "utf-8");
            fs.renameSync(tempPath, configPath);
            logWorldConfigOperation(id, world, "complete", "World config updated successfully", {
                updatedFields: Object.keys(updates)
            });
            return updatedConfig;
        }
        catch (error) {
            const structuredError = createConfigError("write", error instanceof Error ? error.message : "Unknown error", id, "Check file permissions and disk space");
            logError(structuredError, "world-config", id, { worldName: world });
            throw structuredError;
        }
    }
    async shutdown() {
        logger.info("Shutting down all servers...");
        const stopPromises = Array.from(this.instances.values()).map((instance) => {
            if (instance.getStatus() !== "offline") {
                return instance.stop(true);
            }
            return Promise.resolve();
        });
        await Promise.all(stopPromises);
        this.instances.clear();
        this.stopPlayerListPolling();
        this.stopBackupCleanup();
        logger.info("All servers shut down");
    }
    getBackups() {
        const serverBackups = new Map();
        const backupDir = appConfig.backupDir;
        if (!fs.existsSync(backupDir)) {
            return Array.from(serverBackups.values());
        }
        try {
            const entries = fs.readdirSync(backupDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.endsWith("-back")) {
                    const serverId = entry.name.replace("-back", "");
                    const dbServer = getServerFromDb(serverId);
                    if (dbServer) {
                        const serverBackupDir = path.join(backupDir, entry.name);
                        // List all items in the server's backup directory
                        const backupItems = [];
                        try {
                            const items = fs.readdirSync(serverBackupDir, { withFileTypes: true });
                            for (const item of items) {
                                const itemPath = path.join(serverBackupDir, item.name);
                                let size = 0;
                                let modified;
                                try {
                                    const stats = fs.statSync(itemPath);
                                    modified = stats.mtime;
                                    if (item.isDirectory()) {
                                        // Calculate directory size recursively
                                        const calculateSize = (dirPath) => {
                                            let totalSize = 0;
                                            try {
                                                const dirItems = fs.readdirSync(dirPath, { withFileTypes: true });
                                                for (const dirItem of dirItems) {
                                                    const dirItemPath = path.join(dirPath, dirItem.name);
                                                    if (dirItem.isDirectory()) {
                                                        totalSize += calculateSize(dirItemPath);
                                                    }
                                                    else {
                                                        try {
                                                            totalSize += fs.statSync(dirItemPath).size;
                                                        }
                                                        catch {
                                                            // Ignore errors for individual files
                                                        }
                                                    }
                                                }
                                            }
                                            catch {
                                                // Ignore errors
                                            }
                                            return totalSize;
                                        };
                                        size = calculateSize(itemPath);
                                    }
                                    else {
                                        size = stats.size;
                                    }
                                    backupItems.push({
                                        name: item.name,
                                        path: itemPath,
                                        size,
                                        modified,
                                        isDirectory: item.isDirectory(),
                                    });
                                }
                                catch {
                                    // Skip items we can't access
                                }
                            }
                        }
                        catch {
                            // If we can't read the directory, skip it
                        }
                        // Sort by modified date, most recent first
                        backupItems.sort((a, b) => b.modified.getTime() - a.modified.getTime());
                        // Cleanup old backups for this server before returning (but only if we have more than 10)
                        if (backupItems.length > 10) {
                            const MAX_BACKUPS_PER_SERVER = 10;
                            const backupsToDelete = backupItems.slice(MAX_BACKUPS_PER_SERVER);
                            for (const backup of backupsToDelete) {
                                try {
                                    const stats = fs.statSync(backup.path);
                                    if (stats.isDirectory()) {
                                        fs.rmSync(backup.path, { recursive: true, force: true });
                                    }
                                    else {
                                        fs.unlinkSync(backup.path);
                                    }
                                    logger.info(`Deleted old backup for server ${serverId}: ${backup.name} (modified: ${backup.modified.toISOString()})`);
                                }
                                catch (error) {
                                    logger.warn(`Failed to delete old backup ${backup.path} for server ${serverId}: ${error instanceof Error ? error.message : String(error)}`);
                                }
                            }
                            // Update backupItems to only include the kept backups
                            backupItems.splice(MAX_BACKUPS_PER_SERVER);
                        }
                        serverBackups.set(serverId, {
                            serverId,
                            serverName: dbServer.name,
                            backups: backupItems,
                        });
                    }
                }
            }
        }
        catch (error) {
            logger.error(`Failed to read backup directory: ${error instanceof Error ? error.message : String(error)}`);
        }
        return Array.from(serverBackups.values());
    }
    async deleteBackup(serverId, backupName) {
        const backupDir = appConfig.backupDir;
        const serverBackupDir = path.join(backupDir, `${serverId}-back`);
        const backupPath = path.join(serverBackupDir, backupName);
        // Verify the backup path is within the expected directory
        const resolvedPath = path.resolve(backupPath);
        const resolvedServerDir = path.resolve(serverBackupDir);
        if (!resolvedPath.startsWith(resolvedServerDir)) {
            throw createFilesystemError("delete", backupPath, "Path traversal attempt detected", serverId);
        }
        if (!fs.existsSync(backupPath)) {
            throw createFilesystemError("delete", backupPath, "Backup not found", serverId);
        }
        try {
            const stats = fs.statSync(backupPath);
            if (stats.isDirectory()) {
                fs.rmSync(backupPath, { recursive: true, force: true });
            }
            else {
                fs.unlinkSync(backupPath);
            }
            logger.info(`Deleted backup: ${backupPath}`);
        }
        catch (error) {
            logger.error(`Failed to delete backup ${backupPath}: ${error}`);
            throw createFilesystemError("delete", backupPath, error instanceof Error ? error.message : "Unknown error", serverId);
        }
    }
    getBackupPath(serverId, backupName) {
        const backupDir = appConfig.backupDir;
        const serverBackupDir = path.join(backupDir, `${serverId}-back`);
        const backupPath = path.join(serverBackupDir, backupName);
        // Verify the backup path is within the expected directory
        const resolvedPath = path.resolve(backupPath);
        const resolvedServerDir = path.resolve(serverBackupDir);
        if (!resolvedPath.startsWith(resolvedServerDir)) {
            throw createFilesystemError("access", backupPath, "Path traversal attempt detected", serverId);
        }
        if (!fs.existsSync(backupPath)) {
            throw createFilesystemError("access", backupPath, "Backup not found", serverId);
        }
        return backupPath;
    }
    /**
     * Find hytale-downloader executable
     */
    async findDownloader() {
        const commonPaths = [
            "/opt/hytale-downloader/hytale-downloader", // Bundled installation location
            "/usr/local/bin/hytale-downloader",
            "/usr/bin/hytale-downloader",
            "./hytale-downloader"
        ];
        // Check common paths first
        for (const downloadPath of commonPaths) {
            try {
                await fs.promises.access(downloadPath, fs.constants.F_OK | fs.constants.X_OK);
                logger.info(`Found hytale-downloader at: ${downloadPath}`);
                return downloadPath;
            }
            catch {
                // Continue checking
            }
        }
        // Check PATH
        return new Promise((resolve) => {
            const which = spawn("which", ["hytale-downloader"]);
            which.on("close", (code) => {
                if (code === 0) {
                    logger.info("Found hytale-downloader in PATH");
                    resolve("hytale-downloader");
                }
                else {
                    resolve(null);
                }
            });
            which.on("error", () => {
                resolve(null);
            });
        });
    }
    /**
     * Check if a server update is available
     */
    async checkServerUpdate(serverId) {
        const dbServer = getServerFromDb(serverId);
        if (!dbServer) {
            throw createFilesystemError("access", serverId, "Server not found", serverId);
        }
        const currentVersion = dbServer.version || "unknown";
        // Find hytale-downloader
        const downloaderPath = await this.findDownloader();
        if (!downloaderPath) {
            throw new HypanelError("DOWNLOADER_NOT_FOUND", "hytale-downloader not found", "Ensure hytale-downloader is installed and accessible", undefined, 500);
        }
        // Execute hytale-downloader -print-version using spawn for better control
        // Note: -print-version should be fast, but if it hangs, it might be checking for updates
        try {
            logger.info(`Executing hytale-downloader -print-version for server ${serverId}`);
            // Helper function to execute the command
            const executeCommand = async (args) => {
                return new Promise((resolve, reject) => {
                    // Add credentials path if configured (same as installer)
                    const finalArgs = [...args];
                    if (appConfig.downloaderCredentialsPath) {
                        finalArgs.push("-credentials-path", appConfig.downloaderCredentialsPath);
                    }
                    logger.debug(`Spawning: ${downloaderPath} ${finalArgs.join(" ")}`);
                    const childProcess = spawn(downloaderPath, finalArgs, {
                        stdio: ["pipe", "pipe", "pipe"],
                        env: { ...process.env } // Pass through environment variables
                    });
                    let stdout = "";
                    let stderr = "";
                    let timeoutId = null;
                    let hasResolved = false;
                    // Set 10 second timeout (should be fast for -print-version)
                    timeoutId = setTimeout(() => {
                        if (!hasResolved) {
                            hasResolved = true;
                            childProcess.kill("SIGTERM");
                            // Give it a moment to clean up, then force kill
                            setTimeout(() => {
                                try {
                                    childProcess.kill("SIGKILL");
                                }
                                catch {
                                    // Ignore errors on force kill
                                }
                            }, 1000);
                            reject(new Error("Command timed out after 10 seconds. hytale-downloader may be waiting for network or authentication."));
                        }
                    }, 10000);
                    childProcess.stdout?.on("data", (data) => {
                        const text = data.toString();
                        stdout += text;
                        logger.debug(`[hytale-downloader stdout]: ${text.trim()}`);
                    });
                    childProcess.stderr?.on("data", (data) => {
                        const text = data.toString();
                        stderr += text;
                        logger.debug(`[hytale-downloader stderr]: ${text.trim()}`);
                    });
                    childProcess.on("close", (code, signal) => {
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                        }
                        if (hasResolved) {
                            return; // Already handled by timeout
                        }
                        hasResolved = true;
                        logger.debug(`hytale-downloader exited with code ${code}, signal ${signal}`);
                        logger.debug(`stdout: ${stdout || "(empty)"}`);
                        logger.debug(`stderr: ${stderr || "(empty)"}`);
                        if (code === 0) {
                            const version = stdout.trim();
                            if (version) {
                                resolve(version);
                            }
                            else {
                                reject(new Error(`hytale-downloader returned empty version. stdout: "${stdout}", stderr: "${stderr}"`));
                            }
                        }
                        else {
                            const errorMsg = stderr || stdout || `Process exited with code ${code}`;
                            reject(new Error(`hytale-downloader failed: ${errorMsg}`));
                        }
                    });
                    childProcess.on("error", (error) => {
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                        }
                        if (!hasResolved) {
                            hasResolved = true;
                            reject(new Error(`Failed to execute hytale-downloader: ${error.message}`));
                        }
                    });
                });
            };
            // Try with -skip-update-check first
            let latestVersion;
            try {
                const args = ["-print-version", "-skip-update-check"];
                latestVersion = await executeCommand(args);
            }
            catch (firstError) {
                // If that fails, try without -skip-update-check
                logger.warn(`First attempt failed, trying without -skip-update-check: ${firstError instanceof Error ? firstError.message : String(firstError)}`);
                try {
                    const args = ["-print-version"];
                    latestVersion = await executeCommand(args);
                }
                catch (secondError) {
                    // Both attempts failed
                    throw firstError; // Throw the original error
                }
            }
            logger.info(`Latest version from hytale-downloader: ${latestVersion}, current version: ${currentVersion}`);
            // Update version from "unknown" to latest if server is installed
            let updatedVersion = currentVersion;
            if (currentVersion === "unknown" && dbServer.installState === "INSTALLED" && latestVersion !== "unknown") {
                try {
                    await updateServerConfig(serverId, { version: latestVersion });
                    updatedVersion = latestVersion;
                    logger.info(`Updated server ${serverId} version from "unknown" to ${latestVersion} during version check`);
                }
                catch (error) {
                    logger.warn(`Failed to update version from "unknown" for server ${serverId}: ${error instanceof Error ? error.message : String(error)}`);
                    // Continue with "unknown" version - don't fail the check
                }
            }
            const updateAvailable = latestVersion !== updatedVersion && latestVersion !== "unknown" && updatedVersion !== "unknown";
            return {
                updateAvailable,
                currentVersion: updatedVersion,
                latestVersion
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.error(`Failed to check for updates for server ${serverId}: ${errorMessage}`);
            // Check if it's a timeout error
            if (errorMessage.includes("timeout") || errorMessage.includes("timed out")) {
                throw new HypanelError("UPDATE_CHECK_TIMEOUT", "Update check timed out - hytale-downloader did not respond in time. The command may be waiting for network access or authentication.", `Test the command manually: "${downloaderPath}" -print-version. If it hangs, check network connectivity, authentication, or hytale-downloader configuration.`, undefined, 500);
            }
            throw new HypanelError("UPDATE_CHECK_FAILED", `Failed to check for updates: ${errorMessage}`, `Check that hytale-downloader is properly installed and configured. Test manually: "${downloaderPath}" -print-version`, undefined, 500);
        }
    }
    /**
     * Update a server to the latest version
     */
    async updateServer(serverId) {
        const dbServer = getServerFromDb(serverId);
        if (!dbServer) {
            throw createFilesystemError("access", serverId, "Server not found", serverId);
        }
        const instance = this.instances.get(serverId);
        const wasRunning = instance && instance.getStatus() === "online";
        // Step 1: Create backup if server is running (must be done before stopping)
        if (wasRunning && instance) {
            logger.info(`Creating backup for server ${serverId} before update`);
            instance.sendCommand("backup");
            // Wait for backup to complete - monitor console logs
            // We'll wait up to 5 minutes for backup to complete
            let backupComplete = false;
            const startTime = Date.now();
            const timeout = 5 * 60 * 1000; // 5 minutes
            while (!backupComplete && (Date.now() - startTime) < timeout) {
                // Check recent logs for backup completion
                const { getConsoleLogs } = await import("../database/db.js");
                const recentLogs = getConsoleLogs(serverId, 50);
                // Look for backup completion message (this may vary by server implementation)
                // Common patterns: "Backup complete", "Backup saved", etc.
                for (const log of recentLogs.slice().reverse()) {
                    const message = log.message.toLowerCase();
                    if (message.includes("backup") && (message.includes("complete") || message.includes("saved") || message.includes("finished"))) {
                        backupComplete = true;
                        break;
                    }
                }
                if (!backupComplete) {
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Check every 2 seconds
                }
            }
            if (!backupComplete) {
                logger.warn(`Backup completion not detected for server ${serverId}, proceeding anyway`);
            }
            else {
                logger.info(`Backup completed for server ${serverId}`);
            }
            // Step 2: Stop server
            logger.info(`Stopping server ${serverId} for update`);
            await this.stopServer(serverId, false);
            // Wait for server to fully stop
            let attempts = 0;
            while (attempts < 30) {
                const currentInstance = this.instances.get(serverId);
                if (!currentInstance || currentInstance.getStatus() === "offline") {
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }
            if (attempts >= 30) {
                throw new HypanelError("SERVER_STOP_TIMEOUT", "Server did not stop in time", "Try stopping the server manually and try again", undefined, 500);
            }
        }
        // Find hytale-downloader
        const downloaderPath = await this.findDownloader();
        if (!downloaderPath) {
            throw new HypanelError("DOWNLOADER_NOT_FOUND", "hytale-downloader not found", "Ensure hytale-downloader is installed and accessible", undefined, 500);
        }
        // Get server root directory
        const serverRoot = dbServer.serverRoot || path.join(appConfig.serversDir, serverId);
        const resolvedRoot = path.resolve(serverRoot);
        // Step 3: Download update using hytale-downloader (using spawn like the installer)
        logger.info(`Downloading update for server ${serverId}`);
        try {
            const downloadResult = await new Promise((resolve) => {
                const args = [
                    "-download-path", resolvedRoot,
                    "-skip-update-check"
                ];
                // Add credentials path if configured
                if (appConfig.downloaderCredentialsPath) {
                    args.push("-credentials-path", appConfig.downloaderCredentialsPath);
                }
                logger.info(`Executing: ${downloaderPath} ${args.join(" ")}`);
                const childProcess = spawn(downloaderPath, args, {
                    cwd: resolvedRoot,
                    stdio: ["pipe", "pipe", "pipe"]
                });
                let stdout = "";
                let stderr = "";
                let timeoutId = null;
                // Set 30 minute timeout for download
                timeoutId = setTimeout(() => {
                    childProcess.kill("SIGTERM");
                    setTimeout(() => {
                        try {
                            childProcess.kill("SIGKILL");
                        }
                        catch {
                            // Ignore errors on force kill
                        }
                    }, 1000);
                    resolve({
                        success: false,
                        error: "Download timed out after 30 minutes",
                        stdout,
                        stderr
                    });
                }, 30 * 60 * 1000);
                childProcess.stdout?.on("data", (data) => {
                    const text = data.toString();
                    stdout += text;
                    logger.info(`[hytale-downloader][${serverId}] ${text.trim()}`);
                });
                childProcess.stderr?.on("data", (data) => {
                    const text = data.toString();
                    stderr += text;
                    logger.info(`[hytale-downloader][${serverId}][ERROR] ${text.trim()}`);
                });
                childProcess.on("close", (code) => {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                    if (code === 0) {
                        logger.info(`hytale-downloader completed successfully for server ${serverId}`);
                        if (stdout.trim()) {
                            logger.debug(`[hytale-downloader][${serverId}] Full stdout:\n${stdout}`);
                        }
                        if (stderr.trim()) {
                            logger.debug(`[hytale-downloader][${serverId}] Full stderr:\n${stderr}`);
                        }
                        resolve({ success: true, stdout, stderr });
                    }
                    else {
                        const error = stderr || stdout || `Process exited with code ${code}`;
                        logger.error(`hytale-downloader failed for server ${serverId}: ${error}`);
                        if (stdout.trim()) {
                            logger.error(`[hytale-downloader][${serverId}] stdout:\n${stdout}`);
                        }
                        if (stderr.trim()) {
                            logger.error(`[hytale-downloader][${serverId}] stderr:\n${stderr}`);
                        }
                        resolve({ success: false, error, stdout, stderr });
                    }
                });
                childProcess.on("error", (error) => {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                    logger.error(`Failed to execute hytale-downloader for server ${serverId}: ${error.message}`);
                    resolve({ success: false, error: error.message, stdout, stderr });
                });
            });
            if (!downloadResult.success) {
                throw new Error(downloadResult.error || "Download failed");
            }
            logger.info(`Update downloaded successfully for server ${serverId}`);
            // Step 3b: Extract the downloaded ZIP file
            logger.info(`Extracting update for server ${serverId}`);
            const zipPath = `${resolvedRoot}.zip`;
            try {
                // Check if ZIP file exists
                await fs.promises.access(zipPath, fs.constants.F_OK);
                logger.info(`Found ZIP file at: ${zipPath}`);
                // Extract ZIP file to server root
                await execAsync(`unzip -o "${zipPath}" -d "${resolvedRoot}"`);
                logger.info(`Successfully extracted ZIP file for server ${serverId}`);
                // Remove the ZIP file after extraction
                await fs.promises.unlink(zipPath);
                logger.debug(`Removed ZIP file: ${zipPath}`);
            }
            catch (extractError) {
                // If ZIP file doesn't exist, check if files are already extracted
                if (extractError.code === 'ENOENT') {
                    logger.debug(`No ZIP file found at ${zipPath}, files may already be extracted`);
                }
                else {
                    const errorMessage = extractError instanceof Error ? extractError.message : "Unknown extraction error";
                    logger.error(`Failed to extract ZIP file for server ${serverId}: ${errorMessage}`);
                    throw new HypanelError("UPDATE_EXTRACTION_FAILED", `Failed to extract downloaded ZIP file: ${errorMessage}`, "Check disk space and permissions, then retry update", undefined, 500);
                }
            }
        }
        catch (error) {
            logger.error(`Failed to download update: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof HypanelError) {
                throw error;
            }
            throw new HypanelError("UPDATE_DOWNLOAD_FAILED", `Failed to download update: ${error instanceof Error ? error.message : "Unknown error"}`, "Check that hytale-downloader is properly configured and has network access", undefined, 500);
        }
        // Step 4: Get latest version and update in database
        // Use the same spawn approach to avoid hanging
        try {
            logger.info(`Getting latest version to update database for server ${serverId}`);
            const latestVersion = await new Promise((resolve, reject) => {
                const args = ["-print-version", "-skip-update-check"];
                if (appConfig.downloaderCredentialsPath) {
                    args.push("-credentials-path", appConfig.downloaderCredentialsPath);
                }
                const childProcess = spawn(downloaderPath, args, {
                    stdio: ["pipe", "pipe", "pipe"],
                    env: { ...process.env }
                });
                let stdout = "";
                let stderr = "";
                let timeoutId = null;
                let hasResolved = false;
                timeoutId = setTimeout(() => {
                    if (!hasResolved) {
                        hasResolved = true;
                        childProcess.kill("SIGTERM");
                        setTimeout(() => {
                            try {
                                childProcess.kill("SIGKILL");
                            }
                            catch {
                                // Ignore errors on force kill
                            }
                        }, 1000);
                        reject(new Error("Version check timed out"));
                    }
                }, 10000);
                childProcess.stdout?.on("data", (data) => {
                    stdout += data.toString();
                });
                childProcess.stderr?.on("data", (data) => {
                    stderr += data.toString();
                });
                childProcess.on("close", (code) => {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                    if (hasResolved) {
                        return;
                    }
                    hasResolved = true;
                    if (code === 0) {
                        const version = stdout.trim();
                        if (version) {
                            resolve(version);
                        }
                        else {
                            reject(new Error(`Empty version returned. stderr: ${stderr || "none"}`));
                        }
                    }
                    else {
                        const errorMsg = stderr || stdout || `Process exited with code ${code}`;
                        reject(new Error(`Version check failed: ${errorMsg}`));
                    }
                });
                childProcess.on("error", (error) => {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                    if (!hasResolved) {
                        hasResolved = true;
                        reject(new Error(`Failed to execute hytale-downloader: ${error.message}`));
                    }
                });
            });
            // Update server version in database
            await updateServerConfig(serverId, { version: latestVersion });
            logger.info(`Updated server ${serverId} version to ${latestVersion}`);
        }
        catch (error) {
            logger.warn(`Failed to update version in database: ${error instanceof Error ? error.message : String(error)}`);
            // Don't fail the update if we can't update the version field - the files are already updated
        }
        // Step 5: Restart server if it was running before
        if (wasRunning) {
            logger.info(`Restarting server ${serverId} after update`);
            await this.startServer(serverId);
        }
    }
    /**
     * Cleanup old backups for all servers, enforcing a maximum of 10 backups per server
     * Keeps the 10 most recent backups and deletes older ones
     */
    cleanupOldBackups() {
        const backupDir = appConfig.backupDir;
        const MAX_BACKUPS_PER_SERVER = 10;
        if (!fs.existsSync(backupDir)) {
            return;
        }
        try {
            const entries = fs.readdirSync(backupDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.endsWith("-back")) {
                    const serverId = entry.name.replace("-back", "");
                    const serverBackupDir = path.join(backupDir, entry.name);
                    try {
                        const items = fs.readdirSync(serverBackupDir, { withFileTypes: true });
                        // Collect all backups with their modification times
                        const backups = [];
                        for (const item of items) {
                            const itemPath = path.join(serverBackupDir, item.name);
                            try {
                                const stats = fs.statSync(itemPath);
                                backups.push({
                                    name: item.name,
                                    path: itemPath,
                                    modified: stats.mtime,
                                });
                            }
                            catch {
                                // Skip items we can't access
                            }
                        }
                        // Sort by modification date, most recent first
                        backups.sort((a, b) => b.modified.getTime() - a.modified.getTime());
                        // If we have more than MAX_BACKUPS_PER_SERVER, delete the oldest ones
                        if (backups.length > MAX_BACKUPS_PER_SERVER) {
                            const backupsToDelete = backups.slice(MAX_BACKUPS_PER_SERVER);
                            for (const backup of backupsToDelete) {
                                try {
                                    const stats = fs.statSync(backup.path);
                                    if (stats.isDirectory()) {
                                        fs.rmSync(backup.path, { recursive: true, force: true });
                                    }
                                    else {
                                        fs.unlinkSync(backup.path);
                                    }
                                    logger.info(`Deleted old backup for server ${serverId}: ${backup.name} (modified: ${backup.modified.toISOString()})`);
                                }
                                catch (error) {
                                    logger.warn(`Failed to delete old backup ${backup.path} for server ${serverId}: ${error instanceof Error ? error.message : String(error)}`);
                                }
                            }
                            logger.info(`Cleaned up ${backupsToDelete.length} old backup(s) for server ${serverId}, keeping ${MAX_BACKUPS_PER_SERVER} most recent`);
                        }
                    }
                    catch (error) {
                        logger.debug(`Failed to cleanup backups for server ${serverId}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }
        }
        catch (error) {
            logger.error(`Failed to cleanup old backups: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Start periodic polling of player lists via /who command
     * Runs every 5 minutes for all online servers
     */
    startPlayerListPolling() {
        // Poll every 5 minutes (300000 ms)
        this.playerListPollingInterval = setInterval(() => {
            this.pollPlayerLists();
        }, 5 * 60 * 1000);
        // Also poll immediately on startup (after a short delay to let servers start)
        setTimeout(() => {
            this.pollPlayerLists();
        }, 30000); // Wait 30 seconds before first poll
        // Poll again after 2 minutes to catch players who joined early
        setTimeout(() => {
            this.pollPlayerLists();
        }, 2 * 60 * 1000);
        logger.info("Player list polling started (every 5 minutes)");
    }
    /**
     * Poll all online servers for their player lists
     */
    async pollPlayerLists() {
        const onlineServers = Array.from(this.instances.entries()).filter(([, instance]) => instance.getStatus() === "online");
        if (onlineServers.length === 0) {
            return;
        }
        logger.debug(`Polling player lists for ${onlineServers.length} online server(s)`);
        for (const [serverId, instance] of onlineServers) {
            try {
                // Send /who command
                instance.sendCommand("who");
                // Wait a bit for the server to respond (most servers respond quickly)
                await new Promise((resolve) => setTimeout(resolve, 2000));
                // Get recent console logs to find the /who response
                const { getConsoleLogs } = await import("../database/db.js");
                const recentLogs = getConsoleLogs(serverId, 50);
                // Find the most recent log that looks like a player list response
                // Look for logs that contain player names or list patterns
                // Hytale format: "default (1): : Onyxhunter (Onyxhunter)"
                let listOutput = "";
                for (let i = recentLogs.length - 1; i >= 0; i--) {
                    const log = recentLogs[i];
                    if (!log)
                        continue;
                    const lowerMessage = log.message.toLowerCase();
                    // Check if this log looks like a /who response
                    // Hytale format: "default (1): : Onyxhunter (Onyxhunter)"
                    // Look for patterns like "(X): :" or "(X): : " where X is a number
                    const isWhoOutput = /\(\d+\):\s*:\s*.+/.test(log.message) ||
                        lowerMessage.includes("players") ||
                        lowerMessage.includes("online") ||
                        (log.message.includes(",") && log.message.length > 10) ||
                        // Also check for patterns with parentheses indicating player count
                        (log.message.includes(")") && log.message.includes(":"));
                    if (isWhoOutput) {
                        // Check if this log is recent (within last 10 seconds)
                        const logAge = Date.now() - log.timestamp.getTime();
                        if (logAge < 10000) {
                            listOutput = log.message;
                            logger.debug(`Found /who response for server ${serverId}: ${listOutput.substring(0, 200)}`);
                            break;
                        }
                    }
                }
                if (listOutput) {
                    // Parse the list output
                    const playerNames = this.playerTracker.parseListCommand(listOutput);
                    if (playerNames.length > 0 || listOutput.toLowerCase().includes("no players") || listOutput.toLowerCase().includes("0 players")) {
                        // Update player tracker with the parsed list
                        this.playerTracker.updatePlayersFromList(serverId, playerNames);
                        logger.info(`Updated player list for server ${serverId}: ${playerNames.length} players - ${playerNames.join(", ") || "none"}`);
                    }
                    else {
                        logger.debug(`Could not parse player list from server ${serverId} output: ${listOutput.substring(0, 100)}`);
                    }
                }
                else {
                    logger.debug(`No list output found for server ${serverId} in recent logs`);
                }
            }
            catch (error) {
                // Silently handle errors - server might not support /who command
                logger.debug(`Failed to poll player list for server ${serverId}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    /**
     * Stop player list polling
     */
    stopPlayerListPolling() {
        if (this.playerListPollingInterval) {
            clearInterval(this.playerListPollingInterval);
            this.playerListPollingInterval = null;
            logger.info("Player list polling stopped");
        }
    }
    /**
     * Start periodic backup cleanup
     * Runs every hour to enforce the 10 backup limit per server
     */
    startBackupCleanup() {
        // Run cleanup every hour (3600000 ms)
        this.backupCleanupInterval = setInterval(() => {
            this.cleanupOldBackups();
        }, 60 * 60 * 1000);
        // Also run cleanup immediately on startup (after a short delay)
        setTimeout(() => {
            this.cleanupOldBackups();
        }, 60000); // Wait 1 minute before first cleanup
        logger.info("Backup cleanup started (every hour, max 10 backups per server)");
    }
    /**
     * Stop backup cleanup
     */
    stopBackupCleanup() {
        if (this.backupCleanupInterval) {
            clearInterval(this.backupCleanupInterval);
            this.backupCleanupInterval = null;
            logger.info("Backup cleanup stopped");
        }
    }
}
//# sourceMappingURL=ServerManager.js.map