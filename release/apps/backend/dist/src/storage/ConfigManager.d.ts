import { ServerConfig } from "../types/index.js";
export declare class ConfigManager {
    private serversDir;
    constructor();
    private ensureDirectoryExists;
    private getServerDir;
    private getConfigPath;
    saveConfig(serverConfig: ServerConfig): void;
    loadConfig(serverId: string, serverPath?: string): ServerConfig | null;
    deleteConfig(serverId: string): void;
    getAllServerIds(): string[];
    getServerPath(serverId: string): string;
    ensureServerDirectory(serverId: string): string;
}
//# sourceMappingURL=ConfigManager.d.ts.map