import winston from "winston";
import { HypanelErrorContext } from "../errors/index.js";
export declare const logger: winston.Logger;
export declare function getServerLogger(serverId: string): winston.Logger;
export declare function removeServerLogger(serverId: string): void;
export declare function logOperation(operation: 'install' | 'start' | 'stop' | 'config' | 'world-config', serverId: string, phase: string, message: string, level?: 'info' | 'warn' | 'error', details?: Record<string, any>): void;
export declare function logInstallationPhase(serverId: string, phase: string, message: string, details?: Record<string, any>): void;
export declare function logServerStart(serverId: string, phase: string, message: string, details?: Record<string, any>): void;
export declare function logServerStop(serverId: string, phase: string, message: string, details?: Record<string, any>): void;
export declare function logConfigOperation(serverId: string, operation: string, message: string, details?: Record<string, any>): void;
export declare function logWorldConfigOperation(serverId: string, worldName: string, operation: string, message: string, details?: Record<string, any>): void;
export declare function logError(error: Error, operation: string, serverId?: string, context?: HypanelErrorContext): void;
//# sourceMappingURL=Logger.d.ts.map