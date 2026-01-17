import { ServerInstance } from "./ServerInstance.js";
import { ServerConfig, Server, ServerStatus } from "../types/index.js";
import { ConfigManager } from "../storage/ConfigManager.js";
import {
  createServer as createServerInDb,
  getAllServers,
  getServer as getServerFromDb,
  deleteServer as deleteServerFromDb,
  updateServerStatus,
  updateServerPaths,
  updateServerConfig,
} from "../database/db.js";
import { logger, logConfigOperation, logWorldConfigOperation, logError } from "../logger/Logger.js";
import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import pidusage from "pidusage";
import os from "os";
import path from "path";
import { Installer } from "../installation/Installer.js";
import { createConfigError, createFilesystemError, HypanelError } from "../errors/index.js";

export class ServerManager extends EventEmitter {
  private instances: Map<string, ServerInstance>;
  private configManager: ConfigManager;
  private installer: Installer;

  constructor() {
    super();
    this.instances = new Map();
    this.configManager = new ConfigManager();
    this.installer = new Installer();
    this.setupInstallerListeners();
    
    // Recover any interrupted installations before restoring servers
    this.installer.recoverInterruptedInstallations();
    
    this.restoreServers();
  }

  private restoreServers(): void {
    logger.info("Restoring servers from database...");
    const dbServers = getAllServers();

    for (const dbServer of dbServers) {
      // Load config from filesystem (fallback to database config)
      let config = this.configManager.loadConfig(dbServer.id);
      
      // If no config exists, create a basic one from database data
      if (!config && dbServer.serverRoot) {
        config = {
          id: dbServer.id,
          name: dbServer.name,
          path: dbServer.serverRoot,
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
      }
      
      if (config) {
        const instance = new ServerInstance(config);
        this.setupInstanceListeners(instance);
        this.instances.set(dbServer.id, instance);

        // Check if process is still running (by checking PID in database)
        if (dbServer.status === "online") {
          // Mark as offline - we'll need to manually start servers after daemon restart
          // This is safer than trying to reattach to processes
          updateServerStatus(dbServer.id, "offline", null);
        }
      }
    }
    logger.info(`Restored ${this.instances.size} server(s) from database`);
  }

  private setupInstanceListeners(instance: ServerInstance): void {
    instance.on("statusChange", (status: ServerStatus) => {
      this.emit("serverStatusChange", instance.id, status);
    });

    instance.on("log", (log) => {
      this.emit("serverLog", instance.id, log);
    });

    instance.on("stats", (stats) => {
      this.emit("serverStats", instance.id, stats);
    });

    instance.on("command", (command: string) => {
      this.emit("serverCommand", instance.id, command);
    });

    instance.on("exit", (code, signal) => {
      logger.warn(`Server ${instance.id} exited with code ${code}, signal ${signal}`);
      this.emit("serverExit", instance.id, code, signal);
    });

    instance.on("error", (error: Error) => {
      logger.error(`Server ${instance.id} error: ${error.message}`);
      this.emit("serverError", instance.id, error);
    });
  }

  private setupInstallerListeners(): void {
    this.installer.on("installProgress", (serverId: string, progress) => {
      this.emit("serverInstallProgress", serverId, progress);
    });
  }

  async createServer(config: Omit<ServerConfig, "id">): Promise<Server> {
    const id = uuidv4();
    
    // Set Hytale-specific defaults if not provided
    const serverConfig: ServerConfig = {
      ...config,
      executable: config.executable || "java",
      jarFile: config.jarFile || "HytaleServer.jar",
      port: config.port || 5520,
      bindAddress: config.bindAddress || config.ip || "0.0.0.0",
      id,
    };

    // Create canonical server root at ~/hytale/<id> for hypanel user
    const fs = await import("fs/promises");
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    
    const hypanelHome = path.join("/home", "hypanel");
    const serverRoot = path.join(hypanelHome, "hytale", id);
    
    // Ensure the hytale directory exists
    await fs.mkdir(path.join(hypanelHome, "hytale"), { recursive: true });
    await fs.mkdir(serverRoot, { recursive: true });
    
    // Set ownership to hypanel user and proper permissions
    try {
      await execAsync(`chown -R hypanel:hypanel "${serverRoot}"`);
      await execAsync(`chmod 755 "${serverRoot}"`);
      logger.info(`Set ownership and permissions for: ${serverRoot}`);
    } catch (error) {
      logger.warn(`Failed to set ownership for ${serverRoot}: ${error}`);
    }
    
    // Update server config to use canonical path
    serverConfig.path = serverRoot;
    
    logger.info(`Created server directory: ${serverRoot}`);

    // Save config to filesystem
    this.configManager.saveConfig(serverConfig);

    // Create server in database with canonical server root
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
      installState: "NOT_INSTALLED" as any,
      serverRoot,
    });

    // Create server instance
    const instance = new ServerInstance(serverConfig);
    this.setupInstanceListeners(instance);
    this.instances.set(id, instance);

    logger.info(`Created server: ${id} (${config.name})`);

    return this.getServer(id)!;
  }

  async updateServerConfig(id: string, config: Partial<{
    name: string;
    ip: string;
    port: number;
    maxMemory: number;
    maxPlayers: number;
    version?: string;
    args: string[];
    env: Record<string, string>;
    sessionToken?: string;
    identityToken?: string;
    bindAddress?: string;
  }>): Promise<Server> {
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
      const updatedConfig = { ...currentConfig, ...config };
      
      logConfigOperation(id, "filesystem", "Saving server config to filesystem");
      this.configManager.saveConfig(updatedConfig);

      // Update instance config
      instance.config = updatedConfig;

      logConfigOperation(id, "complete", "Server configuration updated successfully", {
        updatedFields: Object.keys(config)
      });
      return this.getServer(id)!;
    } catch (error) {
      const structuredError = createConfigError(
        "update",
        error instanceof Error ? error.message : "Unknown error",
        id,
        "Check file permissions and database connectivity"
      );
      logError(structuredError, "config", id);
      throw structuredError;
    }
  }

  async deleteServer(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Server ${id} not found`);
    }

    // Stop server if running
    if (instance.getStatus() !== "offline") {
      await instance.stop(true);
    }

    // Remove instance
    this.instances.delete(id);
    instance.destroy();

    // Delete from database
    deleteServerFromDb(id);

    // Delete config from filesystem
    this.configManager.deleteConfig(id);

    // Delete server root directory (only the server directory, nothing else)
    const dbServer = getServerFromDb(id);
    if (dbServer?.serverRoot) {
      const fs = require("fs");
      const path = require("path");
      
      // Verify the path is within the expected hypanel directory before deletion
      const resolvedRoot = path.resolve(dbServer.serverRoot);
      const expectedBase = path.resolve("/home/hypanel/hytale");
      
      if (resolvedRoot.startsWith(expectedBase)) {
        try {
          if (fs.existsSync(dbServer.serverRoot)) {
            fs.rmSync(dbServer.serverRoot, { recursive: true, force: true });
            logger.info(`Deleted server directory: ${dbServer.serverRoot}`);
          }
        } catch (error) {
          logger.error(`Failed to delete server directory ${dbServer.serverRoot}: ${error}`);
        }
      } else {
        logger.warn(`Skipping deletion of server directory ${dbServer.serverRoot} - outside expected base path`);
      }
    }

    logger.info(`Deleted server: ${id}`);
  }

  async startServer(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Server ${id} not found`);
    }

    await instance.start();
  }

  async stopServer(id: string, force: boolean = false): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Server ${id} not found`);
    }

    await instance.stop(force);
  }

  async restartServer(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Server ${id} not found`);
    }

    await instance.restart();
  }

  async installServer(id: string): Promise<void> {
    logger.info(`Starting installation for server ${id}`);
    await this.installer.installServer(id);
  }

  sendCommand(id: string, command: string): void {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Server ${id} not found`);
    }

    instance.sendCommand(command);
  }

  getServer(id: string): Server | null {
    const instance = this.instances.get(id);
    if (!instance) {
      return null;
    }

    const dbServer = getServerFromDb(id);
    if (!dbServer) {
      return null;
    }

    // Merge instance data with database data
    const process = instance.getProcess();
    const uptime = process.startTime
      ? Math.floor((Date.now() - process.startTime) / 1000)
      : 0;

    const config = instance.config;

    return {
      ...dbServer,
      status: instance.getStatus(),
      maxMemory: config.maxMemory,
      uptime,
    };
  }

  getAllServers(): Server[] {
    const dbServers = getAllServers();
    
    return dbServers.map((dbServer) => {
      const instance = this.instances.get(dbServer.id);
      if (!instance) {
        return dbServer;
      }

      const process = instance.getProcess();
      const uptime = process.startTime
        ? Math.floor((Date.now() - process.startTime) / 1000)
        : 0;

      const config = instance.config;

      return {
        ...dbServer,
        status: instance.getStatus(),
        maxMemory: config.maxMemory,
        uptime,
      };
    });
  }

  getInstance(id: string): ServerInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * Sanitize a path component to prevent directory traversal attacks
   */
  private sanitizePathComponent(component: string): string {
    // Remove any path separators, parent directory references, and special characters
    return component.replace(/[\/\\:.]/g, '_').replace(/\.\./g, '');
  }

  getWorlds(id: string): string[] {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Server ${id} not found`);
    }

    const dbServer = getServerFromDb(id);
    if (!dbServer || !dbServer.serverRoot) {
      throw new Error(`Server ${id} not properly configured`);
    }

    const fs = require("fs");
    const path = require("path");
    const worldsDir = path.join(dbServer.serverRoot, "universe", "worlds");

    if (!fs.existsSync(worldsDir)) {
      return [];
    }

    try {
      return fs.readdirSync(worldsDir, { withFileTypes: true })
        .filter((dirent: any) => dirent.isDirectory())
        .map((dirent: any) => dirent.name);
    } catch (error) {
      logger.error(`Failed to read worlds directory for server ${id}: ${error}`);
      return [];
    }
  }

  getWorldConfig(id: string, world: string): any {
    logWorldConfigOperation(id, world, "validation", "Reading world config");

    const instance = this.instances.get(id);
    if (!instance) {
      const error = createConfigError("read", "Server not found", id);
      logError(error, "world-config", id);
      throw error;
    }

    const dbServer = getServerFromDb(id);
    if (!dbServer || !dbServer.serverRoot) {
      const error = createConfigError("read", "Server not properly configured", id);
      logError(error, "world-config", id);
      throw error;
    }

    // Sanitize world name to prevent path traversal
    const sanitizedWorld = this.sanitizePathComponent(world);
    
    const fs = require("fs");
    const path = require("path");
    const configPath = path.join(dbServer.serverRoot, "universe", "worlds", sanitizedWorld, "config.json");

    // Verify the resolved path stays within the server root
    const resolvedPath = path.resolve(configPath);
    const rootPath = path.resolve(dbServer.serverRoot);
    if (!resolvedPath.startsWith(rootPath)) {
      const error = createFilesystemError("access", configPath, "Path traversal attempt detected", id);
      logError(error, "world-config", id, { worldName: world });
      throw error;
    }

    if (!fs.existsSync(configPath)) {
      const error = createConfigError(
        "read",
        `World ${world} not found or config.json does not exist`,
        id,
        "Verify the world exists and has been initialized by the server"
      );
      logError(error, "world-config", id, { worldName: world });
      throw error;
    }

    try {
      logWorldConfigOperation(id, world, "loading", "Reading world config file");
      const configContent = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(configContent);
      
      logWorldConfigOperation(id, world, "complete", "World config loaded successfully");
      return config;
    } catch (parseError) {
      const error = createConfigError(
        "parse",
        parseError instanceof Error ? parseError.message : "Invalid JSON",
        id,
        "Check the config.json file for valid JSON syntax"
      );
      logError(error, "world-config", id, { worldName: world });
      throw error;
    }
  }

  updateWorldConfig(id: string, world: string, updates: any): any {
    logWorldConfigOperation(id, world, "validation", "Starting world config update");

    const instance = this.instances.get(id);
    if (!instance) {
      const error = createConfigError("write", "Server not found", id);
      logError(error, "world-config", id);
      throw error;
    }

    const dbServer = getServerFromDb(id);
    if (!dbServer || !dbServer.serverRoot) {
      const error = createConfigError("write", "Server not properly configured", id);
      logError(error, "world-config", id);
      throw error;
    }

    // Check if server is running
    if (dbServer.status === "online" || dbServer.status === "starting") {
      const error = createConfigError(
        "write",
        "Cannot modify world config while server is running",
        id,
        "Stop the server first before modifying world configuration"
      );
      logError(error, "world-config", id);
      throw error;
    }

    // Sanitize world name to prevent path traversal
    const sanitizedWorld = this.sanitizePathComponent(world);
    
    const fs = require("fs");
    const path = require("path");
    const configPath = path.join(dbServer.serverRoot, "universe", "worlds", sanitizedWorld, "config.json");

    // Verify the resolved path stays within the server root
    const resolvedPath = path.resolve(configPath);
    const rootPath = path.resolve(dbServer.serverRoot);
    if (!resolvedPath.startsWith(rootPath)) {
      const error = createFilesystemError("access", configPath, "Path traversal attempt detected", id);
      logError(error, "world-config", id, { worldName: world });
      throw error;
    }

    if (!fs.existsSync(configPath)) {
      const error = createConfigError(
        "write",
        `World ${world} not found or config.json does not exist`,
        id,
        "Verify the world exists and has been initialized by the server"
      );
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
    } catch (error) {
      const structuredError = createConfigError(
        "write",
        error instanceof Error ? error.message : "Unknown error",
        id,
        "Check file permissions and disk space"
      );
      logError(structuredError, "world-config", id, { worldName: world });
      throw structuredError;
    }
  }

  async shutdown(): Promise<void> {
    logger.info("Shutting down all servers...");
    const stopPromises = Array.from(this.instances.values()).map((instance) => {
      if (instance.getStatus() !== "offline") {
        return instance.stop(true);
      }
      return Promise.resolve();
    });

    await Promise.all(stopPromises);
    this.instances.clear();
    logger.info("All servers shut down");
  }
}
