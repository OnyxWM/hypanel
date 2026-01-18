/**
 * Structured error types for hypanel operations
 */
export interface HypanelErrorContext {
    serverId?: string;
    action?: 'install' | 'start' | 'stop' | 'config' | 'world-config';
    phase?: string;
    details?: Record<string, any>;
    worldName?: string;
}
export interface HypanelErrorResponse {
    code: string;
    message: string;
    details?: string;
    suggestedAction?: string;
    context?: HypanelErrorContext;
}
export declare class HypanelError extends Error {
    readonly code: string;
    readonly suggestedAction?: string;
    readonly context?: HypanelErrorContext;
    readonly statusCode: number;
    constructor(code: string, message: string, suggestedAction?: string, context?: HypanelErrorContext, statusCode?: number);
    toJSON(): HypanelErrorResponse;
}
export declare const ERROR_CODES: {
    readonly INSTALL_ALREADY_RUNNING: "INSTALL_ALREADY_RUNNING";
    readonly INSTALL_NOT_INSTALLED: "INSTALL_NOT_INSTALLED";
    readonly INSTALL_DOWNLOADER_NOT_FOUND: "INSTALL_DOWNLOADER_NOT_FOUND";
    readonly INSTALL_DOWNLOAD_FAILED: "INSTALL_DOWNLOAD_FAILED";
    readonly INSTALL_VERIFICATION_FAILED: "INSTALL_VERIFICATION_FAILED";
    readonly INSTALL_PERMISSION_DENIED: "INSTALL_PERMISSION_DENIED";
    readonly INSTALL_DISK_SPACE: "INSTALL_DISK_SPACE";
    readonly SERVER_ALREADY_RUNNING: "SERVER_ALREADY_RUNNING";
    readonly SERVER_NOT_FOUND: "SERVER_NOT_FOUND";
    readonly SERVER_NOT_RUNNING: "SERVER_NOT_RUNNING";
    readonly SERVER_START_FAILED: "SERVER_START_FAILED";
    readonly SERVER_STOP_FAILED: "SERVER_STOP_FAILED";
    readonly SERVER_PROCESS_CRASHED: "SERVER_PROCESS_CRASHED";
    readonly CONFIG_SERVER_RUNNING: "CONFIG_SERVER_RUNNING";
    readonly CONFIG_INVALID_JSON: "CONFIG_INVALID_JSON";
    readonly CONFIG_SAVE_FAILED: "CONFIG_SAVE_FAILED";
    readonly CONFIG_LOAD_FAILED: "CONFIG_LOAD_FAILED";
    readonly CONFIG_VALIDATION_FAILED: "CONFIG_VALIDATION_FAILED";
    readonly AUTH_REQUIRED: "AUTH_REQUIRED";
    readonly AUTH_DEVICE_EXPIRED: "AUTH_DEVICE_EXPIRED";
    readonly AUTH_NETWORK_ERROR: "AUTH_NETWORK_ERROR";
    readonly FILE_NOT_FOUND: "FILE_NOT_FOUND";
    readonly FILE_PERMISSION_DENIED: "FILE_PERMISSION_DENIED";
    readonly FILE_CORRUPTION: "FILE_CORRUPTION";
    readonly PATH_TRAVERSAL: "PATH_TRAVERSAL";
    readonly DATABASE_CONNECTION_FAILED: "DATABASE_CONNECTION_FAILED";
    readonly DATABASE_OPERATION_FAILED: "DATABASE_OPERATION_FAILED";
    readonly INSUFFICIENT_MEMORY: "INSUFFICIENT_MEMORY";
    readonly SYSTEM_TIMEOUT: "SYSTEM_TIMEOUT";
    readonly NETWORK_UNREACHABLE: "NETWORK_UNREACHABLE";
};
export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
export declare function createHypanelError(code: ErrorCode, message: string, suggestedAction?: string, context?: HypanelErrorContext, statusCode?: number): HypanelError;
export declare const createInstallationError: (phase: string, reason: string, serverId: string, suggestedAction?: string) => HypanelError;
export declare const createServerError: (action: "start" | "stop", reason: string, serverId: string, suggestedAction?: string) => HypanelError;
export declare const createConfigError: (operation: "read" | "write" | "validate" | "update" | "parse", reason: string, serverId?: string, suggestedAction?: string) => HypanelError;
export declare const createFilesystemError: (operation: string, filePath: string, reason: string, serverId?: string) => HypanelError;
//# sourceMappingURL=index.d.ts.map