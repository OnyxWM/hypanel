import { ServerInstance } from "./ServerInstance.js";
import { ServerConfig, Server } from "../types/index.js";
import { EventEmitter } from "events";
export declare class ServerManager extends EventEmitter {
    private instances;
    private configManager;
    private installer;
    private playerListPollingInterval;
    private backupCleanupInterval;
    private playerTracker;
    private cachedServerIP;
    constructor();
    private startAutostartServersOnBoot;
    private getHytaleConfigMaxPlayers;
    private notify;
    private restoreServers;
    private setupInstanceListeners;
    private setupInstallerListeners;
    createServer(config: Omit<ServerConfig, "id">): Promise<Server>;
    updateServerConfig(id: string, config: Partial<{
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
        autostart?: boolean;
        backupEnabled?: boolean;
        backupFrequency?: number;
        backupMaxCount?: number;
        aotCacheEnabled?: boolean;
        acceptEarlyPlugins?: boolean;
    }>): Promise<Server>;
    deleteServer(id: string): Promise<void>;
    startServer(id: string): Promise<void>;
    stopServer(id: string, force?: boolean): Promise<void>;
    restartServer(id: string): Promise<void>;
    installServer(id: string): Promise<void>;
    sendCommand(id: string, command: string): void;
    getServerInstance(id: string): ServerInstance | undefined;
    getServer(id: string): Server | null;
    /**
     * Gets the server's actual IP address, with caching.
     * The IP is cached since it doesn't change frequently.
     */
    private getActualServerIP;
    getAllServers(): Server[];
    getInstance(id: string): ServerInstance | undefined;
    /**
     * Sanitize a path component to prevent directory traversal attacks
     */
    private sanitizePathComponent;
    /**
     * Sanitize a server name for filesystem use
     * Converts server name to a filesystem-safe format
     */
    private sanitizeServerName;
    /**
     * Get a unique server directory path, handling name collisions
     * If the sanitized name already exists, appends UUID to ensure uniqueness
     */
    private getUniqueServerDirectory;
    getServerConfig(id: string): any;
    updateHytaleServerConfig(id: string, updates: any): any;
    getWorlds(id: string): string[];
    getWorldConfig(id: string, world: string): any;
    updateWorldConfig(id: string, world: string, updates: any): any;
    shutdown(): Promise<void>;
    getBackups(): Array<{
        serverId: string;
        serverName: string;
        backups: Array<{
            name: string;
            path: string;
            size: number;
            modified: Date;
            isDirectory: boolean;
        }>;
    }>;
    deleteBackup(serverId: string, backupName: string): Promise<void>;
    getBackupPath(serverId: string, backupName: string): string;
    /**
     * Find hytale-downloader executable
     */
    private findDownloader;
    /**
     * Check if a server update is available
     */
    checkServerUpdate(serverId: string): Promise<{
        updateAvailable: boolean;
        currentVersion: string;
        latestVersion: string;
    }>;
    /**
     * Update a server to the latest version
     */
    updateServer(serverId: string): Promise<void>;
    /**
     * Cleanup old backups for all servers, enforcing a maximum of 10 backups per server
     * Keeps the 10 most recent backups and deletes older ones
     */
    cleanupOldBackups(): void;
    /**
     * Start periodic polling of player lists via /who command
     * Runs every 5 minutes for all online servers
     */
    private startPlayerListPolling;
    /**
     * Poll all online servers for their player lists
     */
    private pollPlayerLists;
    /**
     * Stop player list polling
     */
    private stopPlayerListPolling;
    /**
     * Start periodic backup cleanup
     * Runs every hour to enforce the 10 backup limit per server
     */
    private startBackupCleanup;
    /**
     * Stop backup cleanup
     */
    private stopBackupCleanup;
}
//# sourceMappingURL=ServerManager.d.ts.map