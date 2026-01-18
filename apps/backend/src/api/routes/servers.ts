import { Router, Request, Response } from "express";
import { z } from "zod";
import { ServerManager } from "../../server/ServerManager.js";
import { getConsoleLogs, getServerStats, getServer as getServerFromDb } from "../../database/db.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import fs from "fs";
import path from "path";
import { HypanelError } from "../../errors/index.js";
import { logger } from "../../logger/Logger.js";
import { getPlayerTracker } from "../../server/PlayerTracker.js";
import { config } from "../../config/config.js";
import multer from "multer";

const MOD_UPLOAD_MAX_BYTES = 200 * 1024 * 1024; // 200MB
const ALLOWED_MOD_EXTENSIONS = new Set([".jar", ".zip"]);

function sanitizeModFilename(originalName: string): string {
  let name = path.basename(originalName || "");

  // Remove null bytes and obvious path traversal sequences
  name = name.replace(/\0/g, "");
  name = name.replace(/\.\./g, "_");

  // Replace path separators and reserved characters
  name = name.replace(/[\/\\]/g, "_");
  name = name.replace(/[:*?"<>|]/g, "_");

  // Normalize whitespace
  name = name.replace(/\s+/g, " ").trim();

  if (!name) {
    return "mod.jar";
  }

  // Keep names within common filesystem limits
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  const maxLength = 200;
  const clippedBase = base.length > maxLength ? base.slice(0, maxLength) : base;
  return `${clippedBase}${ext}`;
}

const modUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const modsDir = (req as any).hypanel?.modsDir as string | undefined;
      if (!modsDir) {
        return cb(new Error("MISSING_SERVER_CONTEXT"), "");
      }
      return cb(null, modsDir);
    },
    filename: (req, file, cb) => {
      try {
        const modsDir = (req as any).hypanel?.modsDir as string | undefined;
        const resolvedModsDir = (req as any).hypanel?.resolvedModsDir as string | undefined;
        if (!modsDir || !resolvedModsDir) {
          return cb(new Error("MISSING_SERVER_CONTEXT"), "");
        }

        const safeName = sanitizeModFilename(file.originalname);
        const ext = path.extname(safeName).toLowerCase();
        if (!ALLOWED_MOD_EXTENSIONS.has(ext)) {
          return cb(new Error("INVALID_MOD_EXTENSION"), "");
        }

        const targetPath = path.resolve(modsDir, safeName);
        if (!targetPath.startsWith(resolvedModsDir)) {
          return cb(new Error("PATH_TRAVERSAL_DETECTED"), "");
        }

        if (fs.existsSync(targetPath)) {
          return cb(new Error("FILE_ALREADY_EXISTS"), "");
        }

        return cb(null, safeName);
      } catch (e) {
        return cb(e as Error, "");
      }
    },
  }),
  limits: {
    files: 1,
    fileSize: MOD_UPLOAD_MAX_BYTES,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MOD_EXTENSIONS.has(ext)) {
      return cb(new Error("INVALID_MOD_EXTENSION"));
    }
    return cb(null, true);
  },
});

const createServerSchema = z.object({
  name: z.string().min(1).max(100),
  path: z.string().min(1).refine((path) => {
    // Reject path traversal attempts
    if (path.includes('..') || path.includes('~') || path.startsWith('/') || path.includes('\\')) {
      return false;
    }
    return true;
  }, "Path contains invalid characters. Path traversal is not allowed."),
  executable: z.string().default("java"),
  jarFile: z.string().optional(), // For Hytale: "HytaleServer.jar"
  assetsPath: z.string().optional(), // For Hytale: Path to Assets.zip
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  ip: z.string().default("0.0.0.0"),
  port: z.number().int().positive().max(65535).default(5520),
  maxMemory: z.number().int().positive().default(2048),
  maxPlayers: z.number().int().positive().default(20),
  version: z.string().optional(),
  // Hytale-specific authentication
  sessionToken: z.string().optional(),
  identityToken: z.string().optional(),
  bindAddress: z.string().default("0.0.0.0"),
  autostart: z.boolean().default(false),
  backupEnabled: z.boolean().default(true),
  aotCacheEnabled: z.boolean().default(false),
});

const serverIdSchema = z.object({
  id: z.string().min(1),
});

const commandSchema = z.object({
  command: z.string().min(1),
});

const updateServerSchema = createServerSchema.partial();

const hytaleConfigSchema = z.object({
  Version: z.number().int().optional(),
  ServerName: z.string().min(1).max(100),
  MOTD: z.string().optional(),
  Password: z.string().optional(),
  MaxPlayers: z.number().int().positive().max(1000).default(20),
  MaxViewRadius: z.number().int().positive().max(32).default(10),
  LocalCompressionEnabled: z.boolean().default(true),
  DisplayTmpTagsInStrings: z.boolean().optional(),
  Defaults: z.object({
    World: z.string().optional(),
    GameMode: z.enum(["Adventure", "Creative"]).optional(),
  }).optional(),
  ConnectionTimeouts: z.object({
    JoinTimeouts: z.record(z.any()).optional(),
  }).optional(),
  RateLimit: z.record(z.any()).optional(),
  Modules: z.record(z.any()).optional(),
  LogLevels: z.record(z.any()).optional(),
  Mods: z.record(z.any()).optional(),
  PlayerStorage: z.object({
    Type: z.string(),
    Path: z.string().optional(),
  }).optional(),
  AuthCredentialStore: z.object({
    Type: z.string(),
    Path: z.string().optional(),
  }).optional(),
}).partial();

const worldConfigSchema = z.object({
  Version: z.number().int().optional(),
  IsTicking: z.boolean().optional(),
  IsBlockTicking: z.boolean().optional(),
  IsPvpEnabled: z.boolean().optional(),
  IsFallDamageEnabled: z.boolean().optional(),
  IsGameTimePaused: z.boolean().optional(),
  GameTime: z.string().optional(),
  IsSpawningNPC: z.boolean().optional(),
  Seed: z.number().int().optional(),
  SaveNewChunks: z.boolean().optional(),
  IsUnloadingChunks: z.boolean().optional(),
  GameplayConfig: z.string().optional(),
  ClientEffects: z.object({
    SunHeightPercent: z.number().optional(),
    SunAngleDegrees: z.number().optional(),
    BloomIntensity: z.number().optional(),
    BloomPower: z.number().optional(),
    SunIntensity: z.number().optional(),
    SunshaftIntensity: z.number().optional(),
    SunshaftScaleFactor: z.number().optional(),
  }).optional(),
  IsSavingPlayers: z.boolean().optional(),
  IsSavingChunks: z.boolean().optional(),
  IsSpawnMarkersEnabled: z.boolean().optional(),
  IsAllNPCFrozen: z.boolean().optional(),
  IsCompassUpdating: z.boolean().optional(),
  IsObjectiveMarkersEnabled: z.boolean().optional(),
  DeleteOnUniverseStart: z.boolean().optional(),
  DeleteOnRemove: z.boolean().optional(),
  ResourceStorage: z.object({
    Type: z.string(),
  }).optional(),
  WorldGen: z.object({
    Type: z.string(),
    Name: z.string().optional(),
  }).optional(),
  WorldMap: z.object({
    Type: z.string(),
  }).optional(),
  ChunkStorage: z.object({
    Type: z.string(),
  }).optional(),
  ChunkConfig: z.record(z.any()).optional(),
}).partial();

const worldNameSchema = z.object({
  world: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, "World name can only contain letters, numbers, underscores, and hyphens"),
});

export function createServerRoutes(serverManager: ServerManager): Router {
  const router = Router();

  // GET /api/servers - List all servers
  router.get("/", (req: Request, res: Response) => {
    try {
      const servers = serverManager.getAllServers();
      res.json(servers);
    } catch (error) {
      if (error instanceof HypanelError) {
        return res.status(error.statusCode).json(error.toJSON());
      }
      res.status(500).json({ 
        code: "INTERNAL_ERROR",
        message: "Failed to get servers",
        suggestedAction: "Check server logs for details"
      });
    }
  });

  // POST /api/servers - Create new server
  router.post(
    "/",
    validateBody(createServerSchema),
    async (req: Request, res: Response) => {
      try {
        const server = await serverManager.createServer(req.body);
        res.status(201).json(server);
      } catch (error) {
        console.error("CREATE SERVER ERROR:", error);
        logger.error(`Failed to create server: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        res.status(500);
        res.json({
          code: "INTERNAL_ERROR",
          message: "Failed to create server",
          details: error instanceof Error ? error.message : "Unknown error",
          suggestedAction: "Check server logs for details"
        });
      }
    }
  );

  // All specific /:id/... routes must come BEFORE the generic /:id route
  // POST /api/servers/:id/start - Start server
  router.post(
    "/:id/start",
    validateParams(serverIdSchema),
    async (req: Request, res: Response) => {
      logger.info(`POST /api/servers/:id/start called with id: ${req.params.id}`);
      try {
        const { id } = req.params as { id: string };
        await serverManager.startServer(id);
        const server = serverManager.getServer(id);
        res.json(server);
      } catch (error) {
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ 
            code: "SERVER_NOT_FOUND",
            message: error.message,
            suggestedAction: "Verify the server ID is correct"
          });
        }
        res.status(500).json({
          code: "INTERNAL_ERROR",
          message: "Failed to start server",
          details: error instanceof Error ? error.message : "Unknown error",
          suggestedAction: "Check server logs for details"
        });
      }
    }
  );

  // POST /api/servers/:id/stop - Stop server
  router.post(
    "/:id/stop",
    validateParams(serverIdSchema),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        const force = req.query.force === "true";
        await serverManager.stopServer(id, force);
        const server = serverManager.getServer(id);
        res.json(server);
      } catch (error) {
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ 
            code: "SERVER_NOT_FOUND",
            message: error.message,
            suggestedAction: "Verify the server ID is correct"
          });
        }
        res.status(500).json({
          code: "INTERNAL_ERROR",
          message: "Failed to stop server",
          details: error instanceof Error ? error.message : "Unknown error",
          suggestedAction: "Check server logs for details"
        });
      }
    }
  );

  // POST /api/servers/:id/restart - Restart server
  router.post(
    "/:id/restart",
    validateParams(serverIdSchema),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        await serverManager.restartServer(id);
        const server = serverManager.getServer(id);
        res.json(server);
      } catch (error) {
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ 
            code: "SERVER_NOT_FOUND",
            message: error.message,
            suggestedAction: "Verify the server ID is correct"
          });
        }
        res.status(500).json({
          code: "INTERNAL_ERROR",
          message: "Failed to restart server",
          details: error instanceof Error ? error.message : "Unknown error",
          suggestedAction: "Check server logs for details"
        });
      }
    }
  );

  // POST /api/servers/:id/command - Send command to server
  router.post(
    "/:id/command",
    validateParams(serverIdSchema),
    validateBody(commandSchema),
    (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        const { command } = req.body;
        serverManager.sendCommand(id, command);
        res.json({ success: true });
      } catch (error) {
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ 
            code: "SERVER_NOT_FOUND",
            message: error.message,
            suggestedAction: "Verify the server ID is correct"
          });
        }
        // Check for server status errors (offline, starting, etc.)
        if (error instanceof Error && error.message.includes("Cannot send command")) {
          return res.status(400).json({
            code: "SERVER_NOT_READY",
            message: error.message,
            suggestedAction: "Ensure the server is online before sending commands"
          });
        }
        // Check for stdin availability errors
        if (error instanceof Error && error.message.includes("stdin is not available")) {
          return res.status(500).json({
            code: "PROCESS_ERROR",
            message: error.message,
            suggestedAction: "Try restarting the server"
          });
        }
        res.status(500).json({
          code: "INTERNAL_ERROR",
          message: "Failed to send command",
          details: error instanceof Error ? error.message : "Unknown error",
          suggestedAction: "Check server logs for details"
        });
      }
    }
  );

  // POST /api/servers/:id/install - Install server
  router.post(
    "/:id/install",
    validateParams(serverIdSchema),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        await serverManager.installServer(id);
        const server = serverManager.getServer(id);
        res.json({
          success: true,
          message: "Installation started",
          server
        });
      } catch (error) {
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ 
            code: "SERVER_NOT_FOUND",
            message: error.message,
            suggestedAction: "Verify the server ID is correct"
          });
        }
        res.status(500).json({
          code: "INTERNAL_ERROR",
          message: "Failed to start installation",
          details: error instanceof Error ? error.message : "Unknown error",
          suggestedAction: "Check server logs for details"
        });
      }
    }
  );

  // GET /api/servers/:id/logs - Get server logs
  router.get(
    "/:id/logs",
    validateParams(serverIdSchema),
    (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 1000;
        const logs = getConsoleLogs(id, limit);
        res.json(logs);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to get logs" });
      }
    }
  );

  // GET /api/servers/:id/config - Get server config.json
  router.get(
    "/:id/config",
    validateParams(serverIdSchema),
    (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        const serverConfig = serverManager.getServerConfig(id);
        res.json(serverConfig);
      } catch (error) {
        logger.error(`Failed to get server config for ${req.params.id}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        res.status(500).json({ error: `Failed to get server config: ${errorMessage}` });
      }
    }
  );

  // PUT /api/servers/:id/config - Update server config.json
  router.put(
    "/:id/config",
    validateParams(serverIdSchema),
    validateBody(hytaleConfigSchema),
    (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        const updatedConfig = serverManager.updateHytaleServerConfig(id, req.body);
        res.json({ 
          success: true, 
          message: "Server config updated successfully",
          config: updatedConfig 
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to update server config" });
      }
    }
  );

  // GET /api/servers/:id/stats - Get server resource stats
  router.get(
    "/:id/stats",
    validateParams(serverIdSchema),
    (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        const limit = req.query.limit
          ? parseInt(req.query.limit as string, 10)
          : 100;
        const stats = getServerStats(id, limit);
        res.json(stats);
      } catch (error) {
        res.status(500).json({ error: "Failed to get stats" });
      }
    }
  );

  // GET /api/servers/:id/worlds - List worlds
  router.get(
    "/:id/worlds",
    validateParams(serverIdSchema),
    (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        const worlds = serverManager.getWorlds(id);
        res.json(worlds);
      } catch (error) {
        logger.error(`Failed to get worlds for ${req.params.id}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        res.status(500).json({ error: `Failed to get worlds: ${errorMessage}` });
      }
    }
  );

  // GET /api/servers/:id/worlds/:world/config - Get world config.json
  router.get(
    "/:id/worlds/:world/config",
    validateParams(serverIdSchema.merge(worldNameSchema)),
    (req: Request, res: Response) => {
      try {
        const { id, world } = req.params as { id: string; world: string };
        const worldConfig = serverManager.getWorldConfig(id, world);
        res.json(worldConfig);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to get world config" });
      }
    }
  );

  // PUT /api/servers/:id/worlds/:world/config - Update world config.json
  router.put(
    "/:id/worlds/:world/config",
    validateParams(serverIdSchema.merge(worldNameSchema)),
    validateBody(worldConfigSchema),
    (req: Request, res: Response) => {
      try {
        const { id, world } = req.params as { id: string; world: string };
        const updatedConfig = serverManager.updateWorldConfig(id, world, req.body);
        res.json({ 
          success: true, 
          message: "World config updated successfully",
          config: updatedConfig 
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to update world config" });
      }
    }
  );

  // GET /api/servers/backups - List all backups
  router.get("/backups", (req: Request, res: Response) => {
    try {
      const backups = serverManager.getBackups();
      res.json(backups);
    } catch (error) {
      if (error instanceof HypanelError) {
        return res.status(error.statusCode).json(error.toJSON());
      }
      res.status(500).json({
        code: "INTERNAL_ERROR",
        message: "Failed to get backups",
        suggestedAction: "Check server logs for details"
      });
    }
  });

  // GET /api/servers/:id/players - Get players for a specific server
  router.get(
    "/:id/players",
    validateParams(serverIdSchema),
    (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        const playerTracker = getPlayerTracker();
        
        // Verify server exists
        const dbServer = getServerFromDb(id);
        if (!dbServer) {
          return res.status(404).json({
            code: "SERVER_NOT_FOUND",
            message: `Server ${id} not found`,
            suggestedAction: "Verify the server ID is correct",
          });
        }

        const players = playerTracker.getPlayers(id);
        
        // Enrich with server name
        const enrichedPlayers = players.map((player) => ({
          playerName: player.playerName,
          serverId: player.serverId,
          serverName: dbServer.name,
          joinTime: player.joinTime.toISOString(),
          lastSeen: player.lastSeen.toISOString(),
        }));

        res.json(enrichedPlayers);
      } catch (error) {
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        res.status(500).json({
          code: "INTERNAL_ERROR",
          message: "Failed to get server players",
          suggestedAction: "Check server logs for details",
        });
      }
    }
  );

  // POST /api/servers/:id/refresh-players - Manually refresh player list via /who command
  router.post(
    "/:id/refresh-players",
    validateParams(serverIdSchema),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        const instance = serverManager.getServerInstance(id);
        if (!instance) {
          return res.status(404).json({
            code: "SERVER_NOT_FOUND",
            message: `Server ${id} not found`,
            suggestedAction: "Verify the server ID is correct"
          });
        }

        if (instance.getStatus() !== "online") {
          return res.status(400).json({
            code: "SERVER_NOT_ONLINE",
            message: "Server must be online to refresh player list",
            suggestedAction: "Start the server first"
          });
        }

        // Send /who command
        const commandSentTime = Date.now();
        instance.sendCommand("who");
        
        // Wait a bit for response (Hytale servers may take a moment)
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Get recent logs and parse
        const { getConsoleLogs } = await import("../../database/db.js");
        const { getPlayerTracker } = await import("../../server/PlayerTracker.js");
        const recentLogs = getConsoleLogs(id, 100); // Get more logs to ensure we find the response
        const playerTracker = getPlayerTracker();

        // Find the command execution log first, then look for the response after it
        // Hytale format: "default (1): : Onyxhunter (Onyxhunter)"
        let listOutput = "";
        let foundCommand = false;
        
        for (let i = recentLogs.length - 1; i >= 0; i--) {
          const log = recentLogs[i];
          if (!log) continue;
          
          // Check if this is the command execution log
          if (!foundCommand && log.message.toLowerCase().includes("console executed command: who")) {
            foundCommand = true;
            // Now look for the response that comes after this command
            continue;
          }
          
          // If we found the command, look for the response
          if (foundCommand) {
            const lowerMessage = log.message.toLowerCase();
            
            // Skip the command echo line if present
            if (log.message.trim() === "> who" || log.message.trim() === "who") {
              continue;
            }
            
            // Check if this log looks like a /who response
            // Hytale format: "default (1): : Onyxhunter (Onyxhunter)"
            // Look for patterns like "(X): :" or "(X): : " where X is a number
            const isWhoOutput = /\(\d+\):\s*:\s*.+/.test(log.message) ||
              (lowerMessage.includes("players") && (lowerMessage.includes("online") || log.message.includes("("))) ||
              (log.message.includes(",") && log.message.length > 10 && log.message.includes("(")) ||
              // Also check for patterns with parentheses indicating player count
              (log.message.includes(")") && log.message.includes(":") && log.message.includes("(") && /\(\d+\)/.test(log.message));

            if (isWhoOutput) {
              // Check if this log is after the command was sent
              const logTime = log.timestamp.getTime();
              const logAge = commandSentTime - logTime;
              if (logAge < 10000 && logAge > -5000) { // Within 10 seconds after command, but not too far in the past
                listOutput = log.message;
                break;
              }
            }
          }
        }
        
        // Fallback: if we didn't find the command log, just look for recent /who-like responses
        if (!listOutput) {
          for (let i = recentLogs.length - 1; i >= 0; i--) {
            const log = recentLogs[i];
            if (!log) continue;
            
            const lowerMessage = log.message.toLowerCase();
            const isWhoOutput = /\(\d+\):\s*:\s*.+/.test(log.message) ||
              (lowerMessage.includes("players") && log.message.includes("(")) ||
              (log.message.includes(")") && log.message.includes(":") && log.message.includes("(") && /\(\d+\)/.test(log.message));
            
            if (isWhoOutput) {
              const logAge = Date.now() - log.timestamp.getTime();
              if (logAge < 15000) {
                listOutput = log.message;
                break;
              }
            }
          }
        }

        if (listOutput) {
          const playerNames = playerTracker.parseListCommand(listOutput);
          playerTracker.updatePlayersFromList(id, playerNames);
          res.json({
            success: true,
            message: "Player list refreshed",
            players: playerNames.length,
            playerNames
          });
        } else {
          res.json({
            success: false,
            message: "Could not find player list in server response",
            players: 0,
            playerNames: []
          });
        }
      } catch (error) {
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        res.status(500).json({
          code: "INTERNAL_ERROR",
          message: "Failed to refresh player list",
          details: error instanceof Error ? error.message : "Unknown error",
          suggestedAction: "Check server logs for details"
        });
      }
    }
  );

  // DELETE /api/servers/backups/:serverId/:backupName - Delete a backup
  router.delete("/backups/:serverId/:backupName", async (req: Request, res: Response) => {
    try {
      const { serverId, backupName } = req.params as { serverId: string; backupName: string };
      if (!serverId || !backupName) {
        return res.status(400).json({
          code: "INVALID_PARAMS",
          message: "Server ID and backup name are required"
        });
      }
      // Decode the backup name (may contain encoded characters)
      const decodedBackupName = decodeURIComponent(backupName);
      await serverManager.deleteBackup(serverId, decodedBackupName);
      res.status(204).send();
    } catch (error) {
      if (error instanceof HypanelError) {
        return res.status(error.statusCode).json(error.toJSON());
      }
      res.status(500).json({
        code: "INTERNAL_ERROR",
        message: "Failed to delete backup",
        details: error instanceof Error ? error.message : "Unknown error",
        suggestedAction: "Check server logs for details"
      });
    }
  });

  // GET /api/servers/backups/:serverId/:backupName/download - Download a backup
  router.get("/backups/:serverId/:backupName/download", (req: Request, res: Response) => {
    try {
      const { serverId, backupName } = req.params as { serverId: string; backupName: string };
      if (!serverId || !backupName) {
        return res.status(400).json({
          code: "INVALID_PARAMS",
          message: "Server ID and backup name are required"
        });
      }
      // Decode the backup name (may contain encoded characters)
      const decodedBackupName = decodeURIComponent(backupName);
      const backupPath = serverManager.getBackupPath(serverId, decodedBackupName);
      
      const stats = fs.statSync(backupPath);
      
      if (stats.isDirectory()) {
        // For directories, return an error - client should handle zipping if needed
        res.status(400).json({
          code: "DIRECTORY_DOWNLOAD_NOT_SUPPORTED",
          message: "Directory downloads are not supported. Please download individual files.",
          suggestedAction: "Use a file manager or SSH to access directory backups"
        });
      } else {
        // For files, stream directly
        res.download(backupPath, decodedBackupName);
      }
    } catch (error) {
      if (error instanceof HypanelError) {
        return res.status(error.statusCode).json(error.toJSON());
      }
      res.status(500).json({
        code: "INTERNAL_ERROR",
        message: "Failed to download backup",
        details: error instanceof Error ? error.message : "Unknown error",
        suggestedAction: "Check server logs for details"
      });
    }
  });

  // GET /api/servers/:id/mods - List mods in serverRoot/mods
  router.get(
    "/:id/mods",
    validateParams(serverIdSchema),
    (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        const dbServer = getServerFromDb(id);
        if (!dbServer) {
          return res.status(404).json({
            code: "SERVER_NOT_FOUND",
            message: `Server ${id} not found`,
            suggestedAction: "Verify the server ID is correct",
          });
        }

        const serverRoot = dbServer.serverRoot || path.join(config.serversDir, id);
        const modsDir = path.join(serverRoot, "mods");

        const resolvedRoot = path.resolve(serverRoot);
        const resolvedModsDir = path.resolve(modsDir);
        if (!resolvedModsDir.startsWith(resolvedRoot)) {
          return res.status(400).json({
            code: "PATH_TRAVERSAL_DETECTED",
            message: "Path traversal attempt detected",
            suggestedAction: "Verify the server configuration is valid",
          });
        }

        if (!fs.existsSync(modsDir)) {
          fs.mkdirSync(modsDir, { recursive: true, mode: 0o755 });
        }

        const entries = fs.readdirSync(modsDir, { withFileTypes: true });
        const mods = entries
          .filter((e) => e.isFile())
          .map((e) => {
            const filePath = path.join(modsDir, e.name);
            const resolvedFilePath = path.resolve(filePath);
            if (!resolvedFilePath.startsWith(resolvedModsDir)) {
              return null;
            }

            const lstats = fs.lstatSync(filePath);
            if (!lstats.isFile()) {
              return null;
            }

            return {
              name: e.name,
              size: lstats.size,
              modified: lstats.mtime.toISOString(),
            };
          })
          .filter(Boolean)
          .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));

        res.json(mods);
      } catch (error) {
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        res.status(500).json({
          code: "INTERNAL_ERROR",
          message: "Failed to list mods",
          details: error instanceof Error ? error.message : "Unknown error",
          suggestedAction: "Check server logs for details",
        });
      }
    }
  );

  // POST /api/servers/:id/mods/upload - Upload a .jar or .zip into serverRoot/mods
  router.post(
    "/:id/mods/upload",
    validateParams(serverIdSchema),
    (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        const dbServer = getServerFromDb(id);
        if (!dbServer) {
          return res.status(404).json({
            code: "SERVER_NOT_FOUND",
            message: `Server ${id} not found`,
            suggestedAction: "Verify the server ID is correct",
          });
        }

        const serverRoot = dbServer.serverRoot || path.join(config.serversDir, id);
        const modsDir = path.join(serverRoot, "mods");

        const resolvedRoot = path.resolve(serverRoot);
        const resolvedModsDir = path.resolve(modsDir);
        if (!resolvedModsDir.startsWith(resolvedRoot)) {
          return res.status(400).json({
            code: "PATH_TRAVERSAL_DETECTED",
            message: "Path traversal attempt detected",
            suggestedAction: "Verify the server configuration is valid",
          });
        }

        if (!fs.existsSync(modsDir)) {
          fs.mkdirSync(modsDir, { recursive: true, mode: 0o755 });
        }

        ;(req as any).hypanel = { serverRoot, modsDir, resolvedModsDir };

        modUpload.single("file")(req, res, (err: any) => {
          if (err) {
            if (err instanceof multer.MulterError) {
              if (err.code === "LIMIT_FILE_SIZE") {
                return res.status(413).json({
                  code: "FILE_TOO_LARGE",
                  message: `Mod file is too large (max ${Math.floor(MOD_UPLOAD_MAX_BYTES / (1024 * 1024))}MB)`,
                  suggestedAction: "Upload a smaller file",
                });
              }
              return res.status(400).json({
                code: "UPLOAD_ERROR",
                message: "Failed to upload mod",
                details: err.message,
                suggestedAction: "Try again or check server logs",
              });
            }

            const code = err instanceof Error ? err.message : String(err);
            if (code === "INVALID_MOD_EXTENSION") {
              return res.status(400).json({
                code: "INVALID_MOD_EXTENSION",
                message: "Only .jar and .zip files are supported",
                suggestedAction: "Upload a .jar or .zip mod file",
              });
            }
            if (code === "FILE_ALREADY_EXISTS") {
              return res.status(409).json({
                code: "FILE_ALREADY_EXISTS",
                message: "A mod with that filename already exists",
                suggestedAction: "Rename the file and try again",
              });
            }
            if (code === "PATH_TRAVERSAL_DETECTED") {
              return res.status(400).json({
                code: "PATH_TRAVERSAL_DETECTED",
                message: "Invalid filename",
                suggestedAction: "Rename the file and try again",
              });
            }
            if (code === "MISSING_SERVER_CONTEXT") {
              return res.status(500).json({
                code: "INTERNAL_ERROR",
                message: "Upload context missing",
                suggestedAction: "Try again or check server logs",
              });
            }

            return res.status(500).json({
              code: "INTERNAL_ERROR",
              message: "Failed to upload mod",
              details: err instanceof Error ? err.message : "Unknown error",
              suggestedAction: "Check server logs for details",
            });
          }

          const uploaded = (req as any).file as Express.Multer.File | undefined;
          if (!uploaded) {
            return res.status(400).json({
              code: "NO_FILE",
              message: "No file uploaded",
              suggestedAction: "Attach a .jar or .zip file and try again",
            });
          }

          try {
            const entries = fs.readdirSync(modsDir, { withFileTypes: true });
            const mods = entries
              .filter((e) => e.isFile())
              .map((e) => {
                const filePath = path.join(modsDir, e.name);
                const resolvedFilePath = path.resolve(filePath);
                if (!resolvedFilePath.startsWith(resolvedModsDir)) {
                  return null;
                }
                const lstats = fs.lstatSync(filePath);
                if (!lstats.isFile()) {
                  return null;
                }
                return {
                  name: e.name,
                  size: lstats.size,
                  modified: lstats.mtime.toISOString(),
                };
              })
              .filter(Boolean)
              .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));

            return res.json(mods);
          } catch (listErr) {
            return res.status(500).json({
              code: "INTERNAL_ERROR",
              message: "Mod uploaded, but failed to refresh mod list",
              details: listErr instanceof Error ? listErr.message : "Unknown error",
              suggestedAction: "Refresh the page or try again",
            });
          }
        });
      } catch (error) {
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        res.status(500).json({
          code: "INTERNAL_ERROR",
          message: "Failed to upload mod",
          details: error instanceof Error ? error.message : "Unknown error",
          suggestedAction: "Check server logs for details",
        });
      }
    }
  );

  // DELETE /api/servers/:id/mods/:filename - Delete a mod file from serverRoot/mods
  router.delete(
    "/:id/mods/:filename",
    validateParams(serverIdSchema.extend({ filename: z.string().min(1) })),
    (req: Request, res: Response) => {
      try {
        const { id, filename } = req.params as { id: string; filename: string };
        const dbServer = getServerFromDb(id);
        if (!dbServer) {
          return res.status(404).json({
            code: "SERVER_NOT_FOUND",
            message: `Server ${id} not found`,
            suggestedAction: "Verify the server ID is correct",
          });
        }

        const serverRoot = dbServer.serverRoot || path.join(config.serversDir, id);
        const modsDir = path.join(serverRoot, "mods");

        const resolvedRoot = path.resolve(serverRoot);
        const resolvedModsDir = path.resolve(modsDir);
        if (!resolvedModsDir.startsWith(resolvedRoot)) {
          return res.status(400).json({
            code: "PATH_TRAVERSAL_DETECTED",
            message: "Path traversal attempt detected",
            suggestedAction: "Verify the server configuration is valid",
          });
        }

        if (!fs.existsSync(modsDir)) {
          fs.mkdirSync(modsDir, { recursive: true, mode: 0o755 });
        }

        const decoded = decodeURIComponent(filename);
        const safeName = sanitizeModFilename(decoded);
        const ext = path.extname(safeName).toLowerCase();
        if (!ALLOWED_MOD_EXTENSIONS.has(ext)) {
          return res.status(400).json({
            code: "INVALID_MOD_EXTENSION",
            message: "Only .jar and .zip files are supported",
            suggestedAction: "Delete a .jar or .zip mod file",
          });
        }

        const targetPath = path.resolve(modsDir, safeName);
        if (!targetPath.startsWith(resolvedModsDir)) {
          return res.status(400).json({
            code: "PATH_TRAVERSAL_DETECTED",
            message: "Invalid filename",
            suggestedAction: "Verify the filename and try again",
          });
        }

        if (!fs.existsSync(targetPath)) {
          return res.status(404).json({
            code: "FILE_NOT_FOUND",
            message: "Mod file not found",
            suggestedAction: "Refresh the mod list and try again",
          });
        }

        const stats = fs.lstatSync(targetPath);
        if (!stats.isFile()) {
          return res.status(400).json({
            code: "NOT_A_FILE",
            message: "Target is not a file",
            suggestedAction: "Refresh the mod list and try again",
          });
        }

        fs.unlinkSync(targetPath);

        const entries = fs.readdirSync(modsDir, { withFileTypes: true });
        const mods = entries
          .filter((e) => e.isFile())
          .map((e) => {
            const filePath = path.join(modsDir, e.name);
            const resolvedFilePath = path.resolve(filePath);
            if (!resolvedFilePath.startsWith(resolvedModsDir)) {
              return null;
            }
            const lstats = fs.lstatSync(filePath);
            if (!lstats.isFile()) {
              return null;
            }
            return {
              name: e.name,
              size: lstats.size,
              modified: lstats.mtime.toISOString(),
            };
          })
          .filter(Boolean)
          .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));

        res.json(mods);
      } catch (error) {
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        res.status(500).json({
          code: "INTERNAL_ERROR",
          message: "Failed to delete mod",
          details: error instanceof Error ? error.message : "Unknown error",
          suggestedAction: "Check server logs for details",
        });
      }
    }
  );

  // Generic /:id routes must come AFTER all specific /:id/... routes
  // GET /api/servers/:id - Get server details
  router.get(
    "/:id",
    validateParams(serverIdSchema),
    (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        const server = serverManager.getServer(id);
        if (!server) {
          return res.status(404).json({ error: "Server not found" });
        }
        res.json(server);
      } catch (error) {
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        res.status(500).json({ 
          code: "INTERNAL_ERROR", 
          message: "Failed to get server",
          suggestedAction: "Check server logs for details"
        });
      }
    }
  );

  // PUT /api/servers/:id - Update server configuration
  router.put(
    "/:id",
    validateParams(serverIdSchema),
    validateBody(updateServerSchema),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        const server = await serverManager.updateServerConfig(id, req.body);
        res.json(server);
      } catch (error) {
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ 
            code: "SERVER_NOT_FOUND",
            message: error.message,
            suggestedAction: "Verify the server ID is correct"
          });
        }
        res.status(500).json({
          code: "INTERNAL_ERROR",
          message: "Failed to update server",
          details: error instanceof Error ? error.message : "Unknown error",
          suggestedAction: "Check server logs for details"
        });
      }
    }
  );

  // DELETE /api/servers/:id - Delete server
  router.delete(
    "/:id",
    validateParams(serverIdSchema),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        await serverManager.deleteServer(id);
        res.status(204).send();
      } catch (error) {
        console.error("DELETE SERVER ERROR:", error);
        logger.error(`Failed to delete server: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        if (error instanceof HypanelError) {
          return res.status(error.statusCode).json(error.toJSON());
        }
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ 
            code: "SERVER_NOT_FOUND",
            message: error.message,
            suggestedAction: "Verify the server ID is correct"
          });
        }
        res.status(500);
        res.json({ 
          code: "INTERNAL_ERROR",
          message: "Failed to delete server",
          details: error instanceof Error ? error.message : "Unknown error",
          suggestedAction: "Check server logs for details"
        });
      }
    }
  );

  return router;
}
