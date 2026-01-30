import express from "express";
import path from "path";
import fs from "fs";
import { config } from "./src/config/config.js";
import { initDatabase, closeDatabase } from "./src/database/db.js";
import { ServerManager } from "./src/server/ServerManager.js";
import { createServerRoutes } from "./src/api/routes/servers.js";
import { createStatsRoutes } from "./src/api/routes/stats.js";
import { createDownloaderRoutes } from "./src/api/routes/downloader.js";
import { createSystemRoutes } from "./src/api/routes/system.js";
import { createPlayerRoutes } from "./src/api/routes/players.js";
import { createNotificationRoutes } from "./src/api/routes/notifications.js";
import { createAuthRoutes } from "./src/api/routes/auth.js";
import { errorHandler } from "./src/api/middleware/validation.js";
import { requireAuth } from "./src/api/middleware/auth.js";
import { WebSocketServerManager } from "./src/websocket/WebSocketServer.js";
import { logger } from "./src/logger/Logger.js";

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

    // CORS middleware (support cookie auth in dev)
    const allowedOrigins = (process.env.HYPANEL_WEB_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (typeof origin === "string" && allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Vary", "Origin");
        res.header("Access-Control-Allow-Credentials", "true");
      }
      res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (req.method === "OPTIONS") {
        return res.sendStatus(200);
      }
      next();
    });

    // API routes
    app.use("/api/auth", createAuthRoutes());
    app.use("/api/servers", requireAuth, createServerRoutes(serverManager));
    app.use("/api/servers", requireAuth, createStatsRoutes());
    app.use("/api/downloader", requireAuth, createDownloaderRoutes());
    app.use("/api/system", requireAuth, createSystemRoutes(serverManager));
    app.use("/api/players", requireAuth, createPlayerRoutes(serverManager));
    app.use("/api/notifications", requireAuth, createNotificationRoutes());

    // Health check endpoint
    app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // Serve webpanel static files in production
    if (process.env.NODE_ENV === "production") {
      // Try different possible paths for webpanel dist
      let webpanelDistPath = path.join(process.cwd(), "..", "webpanel", "dist");

      // Alternative paths if the above doesn't exist
      const alternativePaths = [
        path.join(process.cwd(), "apps", "webpanel", "dist"),
        path.join(process.env.HYPANEL_INSTALL_DIR || "/opt/hypanel", "apps", "webpanel", "dist"),
        "/opt/hypanel/apps/webpanel/dist"
      ];

      for (const altPath of alternativePaths) {
        if (fs.existsSync(altPath)) {
          webpanelDistPath = altPath;
          break;
        }
      }

      if (fs.existsSync(webpanelDistPath)) {
        app.use(express.static(webpanelDistPath));

        app.get(/^(?!\/api).*/, (req, res) => {
          res.sendFile(path.join(webpanelDistPath, "index.html"));
        });

        logger.info(`Webpanel static files being served from: ${webpanelDistPath}`);
      } else {
        logger.warn(`Webpanel static files not found at: ${webpanelDistPath}`);
      }
    }

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

  if (serverManager) {
    await serverManager.shutdown();
  }

  if (wsServer) {
    wsServer.close();
  }

  if (httpServer) {
    httpServer.close();
  }

  closeDatabase();

  logger.info("Hypanel daemon shut down");
  process.exit(0);
}

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  shutdown();
});

process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  shutdown();
});

process.on("uncaughtException", (error) => {
  logger.error(`Uncaught exception: ${error.message}`, error);
  shutdown();
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  shutdown();
});

// Start daemon
initialize().catch((error) => {
  logger.error(`Failed to start daemon: ${error}`);
  process.exit(1);
});
