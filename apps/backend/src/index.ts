import express from "express";
import { config } from "./config/config.js";
import { initDatabase, closeDatabase } from "./database/db.js";
import { ServerManager } from "./server/ServerManager.js";
import { createServerRoutes } from "./api/routes/servers.js";
import { createStatsRoutes } from "./api/routes/stats.js";
import { errorHandler } from "./api/middleware/validation.js";
import { WebSocketServerManager } from "./websocket/WebSocketServer.js";
import { logger } from "./logger/Logger.js";

let serverManager: ServerManager;
let wsServer: WebSocketServerManager;
let httpServer: any;

async function initialize(): Promise<void> {
  try {
    logger.info("Initializing Hypanel daemon...");

    // Initialize database
    logger.info("Initializing database...");
    initDatabase();
    logger.info("Database initialized");

    // Initialize server manager
    logger.info("Initializing server manager...");
    serverManager = new ServerManager();
    logger.info("Server manager initialized");

    // Initialize Express app
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // CORS middleware (allow all origins for now)
    app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (req.method === "OPTIONS") {
        return res.sendStatus(200);
      }
      next();
    });

    // API routes
    app.use("/api/servers", createServerRoutes(serverManager));
    app.use("/api/servers", createStatsRoutes());

    // Health check endpoint
    app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // Error handler
    app.use(errorHandler);

    // Start HTTP server
    httpServer = app.listen(config.port, () => {
      logger.info(`HTTP server listening on port ${config.port}`);
    });

    // Initialize WebSocket server
    logger.info("Initializing WebSocket server...");
    wsServer = new WebSocketServerManager(config.wsPort, serverManager);
    logger.info("WebSocket server initialized");

    logger.info("Hypanel daemon initialized successfully");
  } catch (error) {
    logger.error(`Failed to initialize: ${error}`);
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  logger.info("Shutting down Hypanel daemon...");

  // Shutdown server manager
  if (serverManager) {
    await serverManager.shutdown();
  }

  // Close WebSocket server
  if (wsServer) {
    wsServer.close();
  }

  // Close HTTP server
  if (httpServer) {
    httpServer.close();
  }

  // Close database
  closeDatabase();

  logger.info("Hypanel daemon shut down");
  process.exit(0);
}

// Handle graceful shutdown
process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  shutdown();
});

process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  shutdown();
});

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  logger.error(`Uncaught exception: ${error.message}`, error);
  shutdown();
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  shutdown();
});

// Start the daemon
initialize().catch((error) => {
  logger.error(`Failed to start daemon: ${error}`);
  process.exit(1);
});
