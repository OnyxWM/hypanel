import fs from "fs";
import path from "path";
import { config } from "../config/config.js";
import { ServerConfig } from "../types/index.js";

export class ConfigManager {
  private serversDir: string;

  constructor() {
    this.serversDir = config.serversDir;
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.serversDir)) {
      fs.mkdirSync(this.serversDir, { recursive: true });
    }
  }

  private getServerDir(serverId: string): string {
    return path.join(this.serversDir, serverId);
  }

  private getConfigPath(serverId: string): string {
    return path.join(this.getServerDir(serverId), "config.json");
  }

  saveConfig(serverConfig: ServerConfig): void {
    const serverDir = this.getServerDir(serverConfig.id);
    const configPath = this.getConfigPath(serverConfig.id);

    // Ensure server directory exists
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }

    // Write config file
    fs.writeFileSync(configPath, JSON.stringify(serverConfig, null, 2), "utf-8");
  }

  loadConfig(serverId: string): ServerConfig | null {
    const configPath = this.getConfigPath(serverId);
    
    if (!fs.existsSync(configPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(content) as ServerConfig;
    } catch (error) {
      throw new Error(`Failed to load config for server ${serverId}: ${error}`);
    }
  }

  deleteConfig(serverId: string): void {
    const serverDir = this.getServerDir(serverId);
    
    if (fs.existsSync(serverDir)) {
      fs.rmSync(serverDir, { recursive: true, force: true });
    }
  }

  getAllServerIds(): string[] {
    if (!fs.existsSync(this.serversDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.serversDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  getServerPath(serverId: string): string {
    return this.getServerDir(serverId);
  }

  ensureServerDirectory(serverId: string): string {
    const serverDir = this.getServerDir(serverId);
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }
    return serverDir;
  }
}
