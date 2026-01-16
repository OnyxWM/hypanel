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
} from "../database/db.js";
import { logger } from "../logger/Logger.js";
import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import pidusage from "pidusage";
import os from "os";
import path from "path";

export class ServerManager extends EventEmitter {
  private instances: Map<string, ServerInstance>;
  private configManager: ConfigManager;

  constructor() {
    super();
    this.instances = new Map();
    this.configManager = new ConfigManager();
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
