import fs from "fs";
import path from "path";
import { config } from "../config/config.js";
import { logger } from "../logger/Logger.js";
export class ConfigManager {
    serversDir;
    constructor() {
        this.serversDir = config.serversDir;
        this.ensureDirectoryExists();
    }
    ensureDirectoryExists() {
        if (!fs.existsSync(this.serversDir)) {
            fs.mkdirSync(this.serversDir, { recursive: true, mode: 0o755 });
        }
        // In production, verify directory ownership and permissions
        if (process.env.NODE_ENV === "production") {
            try {
                const stats = fs.statSync(this.serversDir);
                // Ensure directory is not world-writable for security
                if ((stats.mode & 0o002) !== 0) {
                    logger.warn(`Server directory ${this.serversDir} is world-writable, fixing permissions`);
                    fs.chmodSync(this.serversDir, 0o755);
                }
            }
            catch (error) {
                logger.warn(`Cannot verify permissions for ${this.serversDir}: ${error}`);
            }
        }
    }
    getServerDir(serverId) {
        return path.join(this.serversDir, serverId);
    }
    getConfigPath(serverId) {
        return path.join(this.getServerDir(serverId), "server.json");
    }
    saveConfig(serverConfig) {
        // Use the path from serverConfig if available (supports name-based directories)
        // Otherwise fall back to constructing from serverId (backward compatibility)
        const serverDir = serverConfig.path || this.getServerDir(serverConfig.id);
        const configPath = path.join(serverDir, "server.json");
        // Ensure server directory exists with secure permissions
        if (!fs.existsSync(serverDir)) {
            fs.mkdirSync(serverDir, { recursive: true, mode: 0o755 });
        }
        // Write config file with secure permissions (not world-writable)
        fs.writeFileSync(configPath, JSON.stringify(serverConfig, null, 2), "utf-8");
        fs.chmodSync(configPath, 0o644);
        logger.debug(`Saved server config for ${serverConfig.id} with secure permissions`);
    }
    loadConfig(serverId, serverPath) {
        // Use UUID-based directory: serversDir/serverId/server.json
        // If serverPath is provided, use it (for backward compatibility), otherwise construct from serverId
        const configPath = serverPath && typeof serverPath === "string" && serverPath.trim() !== ""
            ? path.join(serverPath, "server.json")
            : this.getConfigPath(serverId);
        logger.debug(`Loading config for server ${serverId}: configPath=${configPath}`);
        // Migration: If server.json doesn't exist but config.json does, migrate it
        if (!fs.existsSync(configPath)) {
            const oldConfigPath = serverPath && typeof serverPath === "string" && serverPath.trim() !== ""
                ? path.join(serverPath, "config.json")
                : path.join(this.getServerDir(serverId), "config.json");
            if (fs.existsSync(oldConfigPath)) {
                logger.info(`Migrating server config from config.json to server.json for server ${serverId}`);
                try {
                    // Read the old config
                    const content = fs.readFileSync(oldConfigPath, "utf-8");
                    const config = JSON.parse(content);
                    // Validate it's actually a hypanel config (has id, name, maxMemory, etc.)
                    // Hytale's config.json has Version, ServerName, etc. - different structure
                    if (config.id && config.name && (config.maxMemory !== undefined || config.executable)) {
                        // This is a hypanel config, migrate it
                        // Ensure server directory exists
                        const serverDir = serverPath || this.getServerDir(serverId);
                        if (!fs.existsSync(serverDir)) {
                            fs.mkdirSync(serverDir, { recursive: true, mode: 0o755 });
                        }
                        // Write to new location
                        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
                        fs.chmodSync(configPath, 0o644);
                        logger.info(`Successfully migrated server config from config.json to server.json for server ${serverId}`);
                        return config;
                    }
                    else {
                        // This looks like a Hytale config, don't migrate
                        logger.debug(`Old config.json exists but appears to be Hytale server config, not migrating`);
                    }
                }
                catch (error) {
                    logger.warn(`Failed to migrate config.json to server.json for server ${serverId}: ${error}`);
                }
            }
            logger.debug(`Config file not found at: ${configPath}`);
            return null;
        }
        try {
            const content = fs.readFileSync(configPath, "utf-8");
            const config = JSON.parse(content);
            logger.debug(`Successfully loaded config for server ${serverId} from ${configPath}`);
            return config;
        }
        catch (error) {
            throw new Error(`Failed to load config for server ${serverId}: ${error}`);
        }
    }
    deleteConfig(serverId) {
        const serverDir = this.getServerDir(serverId);
        if (fs.existsSync(serverDir)) {
            fs.rmSync(serverDir, { recursive: true, force: true });
        }
    }
    getAllServerIds() {
        if (!fs.existsSync(this.serversDir)) {
            return [];
        }
        const entries = fs.readdirSync(this.serversDir, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
    }
    getServerPath(serverId) {
        return this.getServerDir(serverId);
    }
    ensureServerDirectory(serverId) {
        const serverDir = this.getServerDir(serverId);
        if (!fs.existsSync(serverDir)) {
            fs.mkdirSync(serverDir, { recursive: true, mode: 0o755 });
        }
        return serverDir;
    }
}
//# sourceMappingURL=ConfigManager.js.map