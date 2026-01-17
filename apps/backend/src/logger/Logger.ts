import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
import fs from "fs";
import { config } from "../config/config.js";
import { HypanelErrorContext } from "../errors/index.js";

// Ensure logs directory exists
const logsDir = config.logsDir;
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Main application logger
export const logger = winston.createLogger({
  level: config.nodeEnv === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "hypanel" },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : "";
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      ),
    }),
    // Daily rotate file transport
    new DailyRotateFile({
      filename: path.join(logsDir, "hypanel-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "14d",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
    // Error log file
    new DailyRotateFile({
      filename: path.join(logsDir, "error-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      level: "error",
      maxSize: "20m",
      maxFiles: "30d",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],
});

// Per-server loggers for console output
const serverLoggers = new Map<string, winston.Logger>();

export function getServerLogger(serverId: string): winston.Logger {
  if (serverLoggers.has(serverId)) {
    return serverLoggers.get(serverId)!;
  }

  const serverLogDir = path.join(logsDir, serverId);
  if (!fs.existsSync(serverLogDir)) {
    fs.mkdirSync(serverLogDir, { recursive: true });
  }

  const serverLogger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp} [${level.toUpperCase()}]: ${message}`;
      })
    ),
    transports: [
      // Console log file for the server
      new DailyRotateFile({
        filename: path.join(serverLogDir, "console-%DATE%.log"),
        datePattern: "YYYY-MM-DD",
        maxSize: "50m",
        maxFiles: "30d",
      }),
    ],
  });

  serverLoggers.set(serverId, serverLogger);
  return serverLogger;
}

export function removeServerLogger(serverId: string): void {
  const serverLogger = serverLoggers.get(serverId);
  if (serverLogger) {
    serverLogger.close();
    serverLoggers.delete(serverId);
  }
}

// Structured operational logging functions
export function logOperation(
  operation: 'install' | 'start' | 'stop' | 'config' | 'world-config',
  serverId: string,
  phase: string,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
  details?: Record<string, any>
): void {
  const logData = {
    operation,
    serverId,
    phase,
    message,
    details,
    timestamp: new Date().toISOString()
  };

  logger.log(level, `${operation.toUpperCase()}: ${message}`, logData);
}

export function logInstallationPhase(
  serverId: string,
  phase: string,
  message: string,
  details?: Record<string, any>
): void {
  logOperation('install', serverId, phase, message, 'info', details);
}

export function logServerStart(
  serverId: string,
  phase: string,
  message: string,
  details?: Record<string, any>
): void {
  logOperation('start', serverId, phase, message, 'info', details);
}

export function logServerStop(
  serverId: string,
  phase: string,
  message: string,
  details?: Record<string, any>
): void {
  logOperation('stop', serverId, phase, message, 'info', details);
}

export function logConfigOperation(
  serverId: string,
  operation: string,
  message: string,
  details?: Record<string, any>
): void {
  logOperation('config', serverId, operation, message, 'info', details);
}

export function logWorldConfigOperation(
  serverId: string,
  worldName: string,
  operation: string,
  message: string,
  details?: Record<string, any>
): void {
  const enhancedDetails = { ...details, worldName };
  logOperation('world-config', serverId, operation, message, 'info', enhancedDetails);
}

export function logError(
  error: Error,
  operation: string,
  serverId?: string,
  context?: HypanelErrorContext
): void {
  const errorData: any = {
    operation,
    serverId,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    context,
    timestamp: new Date().toISOString()
  };

  // If it's a HypanelError, include the structured error data
  if (error.name === 'HypanelError') {
    const hypanelError = error as any;
    errorData.error = {
      ...errorData.error,
      code: hypanelError.code,
      suggestedAction: hypanelError.suggestedAction,
      statusCode: hypanelError.statusCode
    };
  }

  logger.error(`${operation} failed: ${error.message}`, errorData);
}
