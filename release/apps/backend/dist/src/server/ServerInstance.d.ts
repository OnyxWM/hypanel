import { ServerConfig, ServerStatus, ServerProcess } from "../types/index.js";
import { EventEmitter } from "events";
export interface BuildStartupArgsOptions {
    jarPath: string;
    assetsPath: string;
    serverId: string;
}
/**
 * Builds the startup argument list from config (sync). Used when customStartupArgs is not set.
 */
export declare function buildStartupArgs(config: ServerConfig, options: BuildStartupArgsOptions): string[];
export declare class ServerInstance extends EventEmitter {
    readonly id: string;
    config: ServerConfig;
    private process;
    private status;
    private statsInterval;
    private logger;
    private playerCount;
    private playerTracker;
    constructor(config: ServerConfig);
    start(): Promise<void>;
    stop(force?: boolean): Promise<void>;
    restart(): Promise<void>;
    sendCommand(command: string): void;
    getStatus(): ServerStatus;
    getProcess(): ServerProcess;
    private handleLogOutput;
    /**
     * Strip ANSI escape codes from a string
     * Handles all ANSI escape sequences including color codes, cursor movements, etc.
     */
    private stripAnsiCodes;
    /**
     * Parse player join/leave events from log lines
     * Extracts player names from various log formats
     */
    private parsePlayerEvents;
    private checkAuthRequirements;
    private handleProcessExit;
    private handleProcessError;
    private startResourceMonitoring;
    private stopResourceMonitoring;
    destroy(): void;
}
//# sourceMappingURL=ServerInstance.d.ts.map