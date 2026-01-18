import Database from "better-sqlite3";
import { Server, ServerStatus, ConsoleLog, ServerStats } from "../types/index.js";
export declare function initDatabase(): Database.Database;
export declare function getDatabase(): Database.Database;
export declare function closeDatabase(): void;
export declare function createServer(server: Omit<Server, "players" | "cpu" | "memory" | "uptime">): void;
export declare function getServer(id: string): Server | null;
export declare function getAllServers(): Server[];
export declare function updateServerStatus(id: string, status: ServerStatus, pid?: number | null): void;
export declare function updateServerInstallState(id: string, installState: any, lastError?: string | null, jarPath?: string | null, assetsPath?: string | null): void;
export declare function tryStartInstallation(id: string): {
    success: boolean;
    reason?: string;
};
export declare function updateServerPaths(id: string, serverRoot: string): void;
export declare function updateServerConfig(id: string, config: Partial<{
    name?: string;
    ip?: string;
    port?: number;
    maxMemory?: number;
    maxPlayers?: number;
    version?: string;
    args?: string[];
    env?: Record<string, string>;
    sessionToken?: string;
    identityToken?: string;
    bindAddress?: string;
    autostart?: boolean;
}>): void;
export declare function deleteServer(id: string): void;
export declare function insertServerStats(stats: ServerStats): void;
export declare function getServerStats(serverId: string, limit?: number): ServerStats[];
export declare function insertConsoleLog(log: Omit<ConsoleLog, "id"> & {
    serverId: string;
}): void;
export declare function getConsoleLogs(serverId: string, limit?: number): ConsoleLog[];
export type NotificationRow = {
    id: string;
    createdAt: string;
    type: string;
    title: string;
    message: string;
    serverId?: string;
    serverName?: string;
};
export declare function insertNotification(input: Omit<NotificationRow, "createdAt"> & {
    createdAt?: string;
}): NotificationRow;
export declare function getNotifications(limit?: number): NotificationRow[];
export declare function pruneNotifications(maxRows?: number): void;
export declare function clearNotifications(): void;
//# sourceMappingURL=db.d.ts.map