import express from "express";
import path from "path";
import fs from "fs";
import { config } from "./config/config.js";
import { initDatabase, closeDatabase } from "./database/db.js";
import { ServerManager } from "./server/ServerManager.js";
import { createServerRoutes } from "./api/routes/servers.js";
import { createDownloaderRoutes } from "./api/routes/downloader.js";
import { createSystemRoutes } from "./api/routes/system.js";
import { createPlayerRoutes } from "./api/routes/players.js";
import { createNotificationRoutes } from "./api/routes/notifications.js";
import { errorHandler } from "./api/middleware/validation.js";
import { WebSocketServerManager } from "./websocket/WebSocketServer.js";
import { logger } from "./logger/Logger.js";
import os from "os";

let serverManager: ServerManager;
let wsServer: WebSocketServerManager;
let httpServer: any;

function verifyRuntimePermissions(): void {
  // In production, ensure we're not running as root for security
  if (process.env.NODE_ENV === "production") {
    if (process.getuid && process.getuid() === 0) {
      logger.error("Security violation: Hypanel daemon should not run as root in production");
      logger.error("Please run as the 'hypanel' user or configure systemd service properly");
      process.exit(1);
    }
    
    // Verify we're running as the hypanel user
    const currentUser = os.userInfo().username;
    if (currentUser !== "hypanel") {
      logger.warn(`Running as user '${currentUser}' instead of 'hypanel'. This may cause permission issues.`);
      logger.warn("For optimal security, run as the 'hypanel' user.");
    } else {
      logger.info("Running as hypanel user - security model verified");
    }
    
    // Verify critical directories exist and are writable
    const criticalDirs = [
      process.env.HYPANEL_SERVERS_DIR || "/home/hypanel/hytale",
      process.env.HYPANEL_LOG_DIR || "/var/log/hypanel"
    ];
    
    for (const dir of criticalDirs) {
      try {
        const fs = require("fs");
        if (!fs.existsSync(dir)) {
          logger.error(`Critical directory missing: ${dir}`);
          logger.error("Please run install.sh to set up the required directories");
          process.exit(1);
        }
        
        // Test write permissions
        const testFile = `${dir}/.hypanel-write-test`;
        fs.writeFileSync(testFile, "test");
        fs.unlinkSync(testFile);
        
        logger.debug(`Directory ${dir} is writable`);
      } catch (error) {
        logger.error(`Cannot write to critical directory ${dir}: ${error}`);
        logger.error("Please check directory permissions and ownership");
        process.exit(1);
      }
    }
    
    logger.info("Runtime permissions model verification passed");
  } else {
    logger.info("Development mode detected - skipping permissions verification");
  }
}

async function initialize(): Promise<void> {
  try {
    logger.info("Initializing Hypanel daemon...");

    // Verify runtime permissions model
    verifyRuntimePermissions();

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

    // API routes - MUST be registered before static file serving
    logger.info("Registering API routes...");
    app.use("/api/servers", createServerRoutes(serverManager));
    logger.info("Server routes registered");
    app.use("/api/downloader", createDownloaderRoutes());
    app.use("/api/system", createSystemRoutes(serverManager));
    const playersRouter = createPlayerRoutes(serverManager);
    app.use("/api/players", playersRouter);
    app.use("/api/notifications", createNotificationRoutes());
    logger.info("All API routes registered (including /api/players)");

    // Health check endpoint
    app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // Serve webpanel static files in production (AFTER API routes)
    logger.info(`NODE_ENV = ${process.env.NODE_ENV}`);
    if (process.env.NODE_ENV === "production") {
      logger.info("In production mode, setting up webpanel static files");
      
      // Try different possible paths for webpanel dist
      let webpanelDistPath = path.join(process.cwd(), "..", "webpanel", "dist");
      logger.info(`Checking primary path: ${webpanelDistPath}`);
      
      // Alternative paths if the above doesn't exist
      const alternativePaths = [
        path.join(process.cwd(), "apps", "webpanel", "dist"),
        path.join(process.env.HYPANEL_INSTALL_DIR || "/opt/hypanel", "apps", "webpanel", "dist"),
        "/opt/hypanel/apps/webpanel/dist"
      ];
      
      // Find the first existing path
      for (const altPath of alternativePaths) {
        if (fs.existsSync(altPath)) {
          webpanelDistPath = altPath;
          logger.info(`Found webpanel at alternative path: ${webpanelDistPath}`);
          break;
        }
      }
      
      if (fs.existsSync(webpanelDistPath)) {
        logger.info(`Setting up static file serving for webpanel at: ${webpanelDistPath}`);
        app.use(express.static(webpanelDistPath));
        
        // Serve index.html for all non-API routes (SPA support)
        app.get("*", (req, res, next) => {
          if (!req.path.startsWith("/api")) {
            res.sendFile(path.join(webpanelDistPath, "index.html"));
          } else {
            next();
          }
        });
        
        logger.info(`Webpanel static files being served from: ${webpanelDistPath}`);
      } else {
        logger.warn(`Webpanel static files not found at: ${webpanelDistPath}`);
      }
    } else {
      logger.info("Not in production mode, skipping webpanel static files");
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
