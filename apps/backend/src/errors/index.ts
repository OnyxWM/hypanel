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

export class HypanelError extends Error {
  public readonly code: string;
  public readonly suggestedAction?: string;
  public readonly context?: HypanelErrorContext;
  public readonly statusCode: number;

  constructor(
    code: string,
    message: string,
    suggestedAction?: string,
    context?: HypanelErrorContext,
    statusCode: number = 500
  ) {
    super(message);
    this.name = 'HypanelError';
    this.code = code;
    this.suggestedAction = suggestedAction;
    this.context = context;
    this.statusCode = statusCode;
  }

  toJSON(): HypanelErrorResponse {
    return {
      code: this.code,
      message: this.message,
      details: this.context?.details?.error || this.context?.details?.reason,
      suggestedAction: this.suggestedAction,
      context: this.context
    };
  }
}

// Error codes and their corresponding messages
export const ERROR_CODES = {
  // Installation errors
  INSTALL_ALREADY_RUNNING: 'INSTALL_ALREADY_RUNNING',
  INSTALL_NOT_INSTALLED: 'INSTALL_NOT_INSTALLED',
  INSTALL_DOWNLOADER_NOT_FOUND: 'INSTALL_DOWNLOADER_NOT_FOUND',
  INSTALL_DOWNLOAD_FAILED: 'INSTALL_DOWNLOAD_FAILED',
  INSTALL_VERIFICATION_FAILED: 'INSTALL_VERIFICATION_FAILED',
  INSTALL_PERMISSION_DENIED: 'INSTALL_PERMISSION_DENIED',
  INSTALL_DISK_SPACE: 'INSTALL_DISK_SPACE',

  // Server operation errors
  SERVER_ALREADY_RUNNING: 'SERVER_ALREADY_RUNNING',
  SERVER_NOT_FOUND: 'SERVER_NOT_FOUND',
  SERVER_NOT_RUNNING: 'SERVER_NOT_RUNNING',
  SERVER_START_FAILED: 'SERVER_START_FAILED',
  SERVER_STOP_FAILED: 'SERVER_STOP_FAILED',
  SERVER_PROCESS_CRASHED: 'SERVER_PROCESS_CRASHED',

  // Configuration errors
  CONFIG_SERVER_RUNNING: 'CONFIG_SERVER_RUNNING',
  CONFIG_INVALID_JSON: 'CONFIG_INVALID_JSON',
  CONFIG_SAVE_FAILED: 'CONFIG_SAVE_FAILED',
  CONFIG_LOAD_FAILED: 'CONFIG_LOAD_FAILED',
  CONFIG_VALIDATION_FAILED: 'CONFIG_VALIDATION_FAILED',

  // Authentication errors
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_DEVICE_EXPIRED: 'AUTH_DEVICE_EXPIRED',
  AUTH_NETWORK_ERROR: 'AUTH_NETWORK_ERROR',

  // Filesystem errors
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_PERMISSION_DENIED: 'FILE_PERMISSION_DENIED',
  FILE_CORRUPTION: 'FILE_CORRUPTION',
  PATH_TRAVERSAL: 'PATH_TRAVERSAL',

  // Database errors
  DATABASE_CONNECTION_FAILED: 'DATABASE_CONNECTION_FAILED',
  DATABASE_OPERATION_FAILED: 'DATABASE_OPERATION_FAILED',

  // System errors
  INSUFFICIENT_MEMORY: 'INSUFFICIENT_MEMORY',
  SYSTEM_TIMEOUT: 'SYSTEM_TIMEOUT',
  NETWORK_UNREACHABLE: 'NETWORK_UNREACHABLE'
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

// Error creation helpers
export function createHypanelError(
  code: ErrorCode,
  message: string,
  suggestedAction?: string,
  context?: HypanelErrorContext,
  statusCode: number = 500
): HypanelError {
  return new HypanelError(code, message, suggestedAction, context, statusCode);
}

// Specific error creators for common operations
export const createInstallationError = (
  phase: string,
  reason: string,
  serverId: string,
  suggestedAction?: string
): HypanelError => {
  return createHypanelError(
    `INSTALL_${phase.toUpperCase().replace(/\s+/g, '_')}` as ErrorCode,
    `Installation failed during ${phase}: ${reason}`,
    suggestedAction || 'Check the installation logs and retry the installation',
    { serverId, action: 'install', phase: phase.toLowerCase(), details: { reason } }
  );
};

export const createServerError = (
  action: 'start' | 'stop',
  reason: string,
  serverId: string,
  suggestedAction?: string
): HypanelError => {
  return createHypanelError(
    `SERVER_${action.toUpperCase()}_FAILED` as ErrorCode,
    `Server ${action} failed: ${reason}`,
    suggestedAction || `Check server logs and try to ${action} again`,
    { serverId, action, phase: action, details: { reason } }
  );
};

export const createConfigError = (
  operation: 'read' | 'write' | 'validate' | 'update' | 'parse',
  reason: string,
  serverId?: string,
  suggestedAction?: string
): HypanelError => {
  return createHypanelError(
    `CONFIG_${operation.toUpperCase()}_FAILED` as ErrorCode,
    `Configuration ${operation} failed: ${reason}`,
    suggestedAction || 'Ensure the server is stopped and try again',
    { serverId, action: 'config', phase: operation, details: { reason } }
  );
};

export const createFilesystemError = (
  operation: string,
  filePath: string,
  reason: string,
  serverId?: string
): HypanelError => {
  return createHypanelError(
    ERROR_CODES.FILE_PERMISSION_DENIED,
    `Filesystem ${operation} failed for ${filePath}: ${reason}`,
    'Check file permissions and disk space',
    { serverId, action: 'config', phase: operation.toLowerCase(), details: { filePath, reason } }
  );
};