import { Router } from "express";
import { z } from "zod";
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
const FILE_MANAGER_UPLOAD_MAX_BYTES = 200 * 1024 * 1024; // 200MB
const ALLOWED_MOD_EXTENSIONS = new Set([".jar", ".zip"]);
/**
 * Normalize relative path (decode, strip .. and empty segments) and resolve against server root.
 * Returns { resolvedPath, resolvedRoot } if contained; otherwise throws (caller returns 400).
 */
function resolveServerPath(serverRoot, relativePath) {
    const resolvedRoot = path.resolve(serverRoot);
    const decoded = decodeURIComponent(relativePath || "").replace(/\\/g, "/").trim();
    const segments = decoded.split("/").filter((s) => s.length > 0 && s !== "..");
    const normalized = segments.join(path.sep);
    const resolvedPath = path.resolve(serverRoot, normalized);
    if (!resolvedPath.startsWith(resolvedRoot)) {
        throw new Error("PATH_TRAVERSAL_DETECTED");
    }
    return { resolvedPath, resolvedRoot };
}
function sanitizeFileFilename(originalName) {
    let name = path.basename(originalName || "");
    name = name.replace(/\0/g, "");
    name = name.replace(/\.\./g, "_");
    name = name.replace(/[\/\\]/g, "_");
    name = name.replace(/[:*?"<>|]/g, "_");
    name = name.replace(/\s+/g, " ").trim();
    if (!name) {
        return "file";
    }
    const ext = path.extname(name);
    const base = ext ? name.slice(0, -ext.length) : name;
    const maxLength = 200;
    const clippedBase = base.length > maxLength ? base.slice(0, maxLength) : base;
    return `${clippedBase}${ext}`;
}
function sanitizeModFilename(originalName) {
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
            const modsDir = req.hypanel?.modsDir;
            if (!modsDir) {
                return cb(new Error("MISSING_SERVER_CONTEXT"), "");
            }
            return cb(null, modsDir);
        },
        filename: (req, file, cb) => {
            try {
                const modsDir = req.hypanel?.modsDir;
                const resolvedModsDir = req.hypanel?.resolvedModsDir;
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
            }
            catch (e) {
                return cb(e, "");
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
/** Sanitize relative path segments and return a safe path string (no leading slash, no ..). */
function sanitizeRelativePath(relativePath) {
    const normalized = (relativePath || "").replace(/\\/g, "/").trim().replace(/^\/+/, "");
    const segments = normalized.split("/").map((seg) => {
        let s = seg.replace(/\0/g, "").replace(/\.\./g, "_");
        s = s.replace(/[\\:*?"<>|]/g, "_").trim();
        return s;
    }).filter(Boolean);
    return segments.join(path.sep);
}
const fileManagerUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: FILE_MANAGER_UPLOAD_MAX_BYTES,
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
    backupFrequency: z.number().int().positive().default(30).optional(),
    backupMaxCount: z.number().int().positive().default(5).optional(),
    aotCacheEnabled: z.boolean().default(false),
    acceptEarlyPlugins: z.boolean().default(false),
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
const box2DSchema = z.object({
    Min: z.array(z.number()).length(2).optional(),
    Max: z.array(z.number()).length(2).optional(),
}).optional().nullable();
const spawnPointSchema = z.object({
    Position: z.array(z.number()).length(3).optional(),
    Rotation: z.array(z.number()).length(3).optional(),
}).optional();
const spawnProviderSchema = z.lazy(() => z.object({
    Type: z.enum(["Global", "Individual", "FitToHeightMap"]).optional(),
    SpawnPoint: spawnPointSchema.optional(),
    SpawnPoints: z.array(spawnPointSchema).optional(),
    SpawnProvider: spawnProviderSchema.optional(),
}).optional().nullable());
const worldConfigSchema = z.object({
    UUID: z.string().optional(),
    DisplayName: z.string().nullable().optional(),
    Version: z.number().int().optional(),
    IsTicking: z.boolean().optional(),
    IsBlockTicking: z.boolean().optional(),
    IsPvpEnabled: z.boolean().optional(),
    IsFallDamageEnabled: z.boolean().optional(),
    IsGameTimePaused: z.boolean().optional(),
    GameTime: z.string().optional(),
    ForcedWeather: z.string().nullable().optional(),
    IsSpawningNPC: z.boolean().optional(),
    Seed: z.number().int().optional(),
    SaveNewChunks: z.boolean().optional(),
    IsUnloadingChunks: z.boolean().optional(),
    GameplayConfig: z.string().optional(),
    GameMode: z.string().nullable().optional(),
    Death: z.record(z.any()).nullable().optional(),
    DaytimeDurationSeconds: z.number().int().nullable().optional(),
    NighttimeDurationSeconds: z.number().int().nullable().optional(),
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
        Path: z.string().optional(),
    }).optional(),
    WorldMap: z.object({
        Type: z.string(),
    }).optional(),
    ChunkStorage: z.object({
        Type: z.string(),
    }).optional(),
    ChunkConfig: z.object({
        PregenerateRegion: box2DSchema,
        KeepLoadedRegion: box2DSchema,
    }).optional(),
    SpawnProvider: spawnProviderSchema,
}).partial();
const worldNameSchema = z.object({
    world: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, "World name can only contain letters, numbers, underscores, and hyphens"),
});
export function createServerRoutes(serverManager) {
    const router = Router();
    // GET /api/servers - List all servers
    router.get("/", (req, res) => {
        try {
            const servers = serverManager.getAllServers();
            res.json(servers);
        }
        catch (error) {
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
    router.post("/", validateBody(createServerSchema), async (req, res) => {
        try {
            const server = await serverManager.createServer(req.body);
            res.status(201).json(server);
        }
        catch (error) {
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
    });
    // All specific /:id/... routes must come BEFORE the generic /:id route
    // POST /api/servers/:id/start - Start server
    router.post("/:id/start", validateParams(serverIdSchema), async (req, res) => {
        logger.info(`POST /api/servers/:id/start called with id: ${req.params.id}`);
        try {
            const { id } = req.params;
            await serverManager.startServer(id);
            const server = serverManager.getServer(id);
            res.json(server);
        }
        catch (error) {
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
    });
    // POST /api/servers/:id/stop - Stop server
    router.post("/:id/stop", validateParams(serverIdSchema), async (req, res) => {
        try {
            const { id } = req.params;
            const force = req.query.force === "true";
            await serverManager.stopServer(id, force);
            const server = serverManager.getServer(id);
            res.json(server);
        }
        catch (error) {
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
    });
    // POST /api/servers/:id/restart - Restart server
    router.post("/:id/restart", validateParams(serverIdSchema), async (req, res) => {
        try {
            const { id } = req.params;
            await serverManager.restartServer(id);
            const server = serverManager.getServer(id);
            res.json(server);
        }
        catch (error) {
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
    });
    // POST /api/servers/:id/command - Send command to server
    router.post("/:id/command", validateParams(serverIdSchema), validateBody(commandSchema), (req, res) => {
        try {
            const { id } = req.params;
            const { command } = req.body;
            serverManager.sendCommand(id, command);
            res.json({ success: true });
        }
        catch (error) {
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
    });
    // POST /api/servers/:id/install - Install server
    router.post("/:id/install", validateParams(serverIdSchema), async (req, res) => {
        try {
            const { id } = req.params;
            await serverManager.installServer(id);
            const server = serverManager.getServer(id);
            res.json({
                success: true,
                message: "Installation started",
                server
            });
        }
        catch (error) {
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
    });
    // GET /api/servers/:id/logs - Get server logs
    router.get("/:id/logs", validateParams(serverIdSchema), (req, res) => {
        try {
            const { id } = req.params;
            const limit = req.query.limit ? parseInt(req.query.limit, 10) : 1000;
            const logs = getConsoleLogs(id, limit);
            res.json(logs);
        }
        catch (error) {
            if (error instanceof Error && error.message.includes("not found")) {
                return res.status(404).json({ error: error.message });
            }
            res.status(500).json({ error: "Failed to get logs" });
        }
    });
    // GET /api/servers/:id/config - Get server config.json
    router.get("/:id/config", validateParams(serverIdSchema), (req, res) => {
        try {
            const { id } = req.params;
            const serverConfig = serverManager.getServerConfig(id);
            res.json(serverConfig);
        }
        catch (error) {
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
    });
    // PUT /api/servers/:id/config - Update server config.json
    router.put("/:id/config", validateParams(serverIdSchema), validateBody(hytaleConfigSchema), (req, res) => {
        try {
            const { id } = req.params;
            const updatedConfig = serverManager.updateHytaleServerConfig(id, req.body);
            res.json({
                success: true,
                message: "Server config updated successfully",
                config: updatedConfig
            });
        }
        catch (error) {
            if (error instanceof Error && error.message.includes("not found")) {
                return res.status(404).json({ error: error.message });
            }
            res.status(500).json({ error: "Failed to update server config" });
        }
    });
    // GET /api/servers/:id/stats - Get server resource stats
    router.get("/:id/stats", validateParams(serverIdSchema), (req, res) => {
        try {
            const { id } = req.params;
            const limit = req.query.limit
                ? parseInt(req.query.limit, 10)
                : 100;
            const stats = getServerStats(id, limit);
            res.json(stats);
        }
        catch (error) {
            res.status(500).json({ error: "Failed to get stats" });
        }
    });
    // GET /api/servers/:id/worlds - List worlds
    router.get("/:id/worlds", validateParams(serverIdSchema), (req, res) => {
        try {
            const { id } = req.params;
            const worlds = serverManager.getWorlds(id);
            res.json(worlds);
        }
        catch (error) {
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
    });
    // GET /api/servers/:id/worlds/:world/config - Get world config.json
    router.get("/:id/worlds/:world/config", validateParams(serverIdSchema.merge(worldNameSchema)), (req, res) => {
        try {
            const { id, world } = req.params;
            const worldConfig = serverManager.getWorldConfig(id, world);
            res.json(worldConfig);
        }
        catch (error) {
            if (error instanceof Error && error.message.includes("not found")) {
                return res.status(404).json({ error: error.message });
            }
            res.status(500).json({ error: "Failed to get world config" });
        }
    });
    // PUT /api/servers/:id/worlds/:world/config - Update world config.json
    router.put("/:id/worlds/:world/config", validateParams(serverIdSchema.merge(worldNameSchema)), validateBody(worldConfigSchema), (req, res) => {
        try {
            const { id, world } = req.params;
            const updatedConfig = serverManager.updateWorldConfig(id, world, req.body);
            res.json({
                success: true,
                message: "World config updated successfully",
                config: updatedConfig
            });
        }
        catch (error) {
            if (error instanceof Error && error.message.includes("not found")) {
                return res.status(404).json({ error: error.message });
            }
            res.status(500).json({ error: "Failed to update world config" });
        }
    });
    // GET /api/servers/backups - List all backups
    router.get("/backups", (req, res) => {
        try {
            const backups = serverManager.getBackups();
            res.json(backups);
        }
        catch (error) {
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
    router.get("/:id/players", validateParams(serverIdSchema), (req, res) => {
        try {
            const { id } = req.params;
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
        }
        catch (error) {
            if (error instanceof HypanelError) {
                return res.status(error.statusCode).json(error.toJSON());
            }
            res.status(500).json({
                code: "INTERNAL_ERROR",
                message: "Failed to get server players",
                suggestedAction: "Check server logs for details",
            });
        }
    });
    // POST /api/servers/:id/refresh-players - Manually refresh player list via /who command
    router.post("/:id/refresh-players", validateParams(serverIdSchema), async (req, res) => {
        try {
            const { id } = req.params;
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
                if (!log)
                    continue;
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
                    if (!log)
                        continue;
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
            }
            else {
                res.json({
                    success: false,
                    message: "Could not find player list in server response",
                    players: 0,
                    playerNames: []
                });
            }
        }
        catch (error) {
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
    });
    // DELETE /api/servers/backups/:serverId/:backupName - Delete a backup
    router.delete("/backups/:serverId/:backupName", async (req, res) => {
        try {
            const { serverId, backupName } = req.params;
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
        }
        catch (error) {
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
    router.get("/backups/:serverId/:backupName/download", (req, res) => {
        try {
            const { serverId, backupName } = req.params;
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
            }
            else {
                // For files, stream directly
                res.download(backupPath, decodedBackupName);
            }
        }
        catch (error) {
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
    router.get("/:id/mods", validateParams(serverIdSchema), (req, res) => {
        try {
            const { id } = req.params;
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
                .sort((a, b) => String(a.name).localeCompare(String(b.name)));
            res.json(mods);
        }
        catch (error) {
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
    });
    // POST /api/servers/:id/mods/upload - Upload a .jar or .zip into serverRoot/mods
    router.post("/:id/mods/upload", validateParams(serverIdSchema), (req, res) => {
        try {
            const { id } = req.params;
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
            ;
            req.hypanel = { serverRoot, modsDir, resolvedModsDir };
            modUpload.single("file")(req, res, (err) => {
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
                const uploaded = req.file;
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
                        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
                    return res.json(mods);
                }
                catch (listErr) {
                    return res.status(500).json({
                        code: "INTERNAL_ERROR",
                        message: "Mod uploaded, but failed to refresh mod list",
                        details: listErr instanceof Error ? listErr.message : "Unknown error",
                        suggestedAction: "Refresh the page or try again",
                    });
                }
            });
        }
        catch (error) {
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
    });
    // DELETE /api/servers/:id/mods/:filename - Delete a mod file from serverRoot/mods
    router.delete("/:id/mods/:filename", validateParams(serverIdSchema.extend({ filename: z.string().min(1) })), (req, res) => {
        try {
            const { id, filename } = req.params;
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
                .sort((a, b) => String(a.name).localeCompare(String(b.name)));
            res.json(mods);
        }
        catch (error) {
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
    });
    // GET /api/servers/:id/files - List directory (path = relative path, default "")
    router.get("/:id/files", validateParams(serverIdSchema), (req, res) => {
        try {
            const { id } = req.params;
            const rawPath = req.query.path ?? "";
            logger.info(`[FileManager] List files: serverId=${id}, path="${rawPath}"`);
            const dbServer = getServerFromDb(id);
            if (!dbServer) {
                return res.status(404).json({
                    code: "SERVER_NOT_FOUND",
                    message: `Server ${id} not found`,
                    suggestedAction: "Verify the server ID is correct",
                });
            }
            const serverRoot = dbServer.serverRoot || path.join(config.serversDir, id);
            let resolvedPath;
            let resolvedRoot;
            try {
                const out = resolveServerPath(serverRoot, rawPath);
                resolvedPath = out.resolvedPath;
                resolvedRoot = out.resolvedRoot;
            }
            catch (e) {
                return res.status(400).json({
                    code: "PATH_TRAVERSAL_DETECTED",
                    message: "Invalid path",
                    suggestedAction: "Use a path within the server directory",
                });
            }
            if (!fs.existsSync(resolvedPath)) {
                return res.status(404).json({
                    code: "NOT_FOUND",
                    message: "Directory not found",
                    suggestedAction: "Check the path",
                });
            }
            const stat = fs.statSync(resolvedPath);
            if (!stat.isDirectory()) {
                return res.status(400).json({
                    code: "NOT_A_DIRECTORY",
                    message: "Path is not a directory",
                    suggestedAction: "Use a directory path to list contents",
                });
            }
            const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
            const result = entries
                .map((e) => {
                const entryPath = path.join(resolvedPath, e.name);
                const resolvedEntryPath = path.resolve(entryPath);
                if (!resolvedEntryPath.startsWith(resolvedRoot)) {
                    return null;
                }
                try {
                    const lstats = fs.lstatSync(entryPath);
                    return {
                        name: e.name,
                        size: lstats.isFile() ? lstats.size : 0,
                        modified: lstats.mtime.toISOString(),
                        isDirectory: lstats.isDirectory(),
                    };
                }
                catch {
                    return null;
                }
            })
                .filter(Boolean);
            result.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory)
                    return a.isDirectory ? -1 : 1;
                return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
            });
            logger.info(`[FileManager] List files done: serverId=${id}, path="${rawPath}", entries=${result.length}`);
            res.json({ path: rawPath || "", entries: result });
        }
        catch (error) {
            logger.error(`[FileManager] List files error: serverId=${req.params.id}`, error);
            if (error instanceof HypanelError) {
                return res.status(error.statusCode).json(error.toJSON());
            }
            res.status(500).json({
                code: "INTERNAL_ERROR",
                message: "Failed to list files",
                details: error instanceof Error ? error.message : "Unknown error",
                suggestedAction: "Check server logs for details",
            });
        }
    });
    // POST /api/servers/:id/files/upload - Upload file to directory (query path = relative dir)
    router.post("/:id/files/upload", validateParams(serverIdSchema), (req, res) => {
        try {
            const { id } = req.params;
            const rawPath = req.query.path ?? "";
            logger.info(`[FileManager] Upload start: serverId=${id}, path="${rawPath}"`);
            const dbServer = getServerFromDb(id);
            if (!dbServer) {
                return res.status(404).json({
                    code: "SERVER_NOT_FOUND",
                    message: `Server ${id} not found`,
                    suggestedAction: "Verify the server ID is correct",
                });
            }
            const serverRoot = dbServer.serverRoot || path.join(config.serversDir, id);
            let resolvedPath;
            let resolvedRoot;
            try {
                const out = resolveServerPath(serverRoot, rawPath);
                resolvedPath = out.resolvedPath;
                resolvedRoot = out.resolvedRoot;
            }
            catch (e) {
                return res.status(400).json({
                    code: "PATH_TRAVERSAL_DETECTED",
                    message: "Invalid path",
                    suggestedAction: "Use a path within the server directory",
                });
            }
            if (!fs.existsSync(resolvedPath)) {
                fs.mkdirSync(resolvedPath, { recursive: true, mode: 0o755 });
            }
            const stat = fs.statSync(resolvedPath);
            if (!stat.isDirectory()) {
                return res.status(400).json({
                    code: "NOT_A_DIRECTORY",
                    message: "Upload path is not a directory",
                    suggestedAction: "Use a directory path",
                });
            }
            req.hypanel = { filesDir: resolvedPath, resolvedFilesDir: path.resolve(resolvedPath) };
            fileManagerUpload.array("files")(req, res, (err) => {
                if (err) {
                    if (err instanceof multer.MulterError) {
                        if (err.code === "LIMIT_FILE_SIZE") {
                            return res.status(413).json({
                                code: "FILE_TOO_LARGE",
                                message: `One or more files are too large (max ${Math.floor(FILE_MANAGER_UPLOAD_MAX_BYTES / (1024 * 1024))}MB each)`,
                                suggestedAction: "Upload smaller files",
                            });
                        }
                        return res.status(400).json({
                            code: "UPLOAD_ERROR",
                            message: "Failed to upload files",
                            details: err.message,
                            suggestedAction: "Try again or check server logs",
                        });
                    }
                    const code = err instanceof Error ? err.message : String(err);
                    if (code === "PATH_TRAVERSAL_DETECTED" || code === "MISSING_SERVER_CONTEXT") {
                        return res.status(400).json({
                            code: "PATH_TRAVERSAL_DETECTED",
                            message: "Invalid path or filename",
                            suggestedAction: "Try again",
                        });
                    }
                    return res.status(500).json({
                        code: "INTERNAL_ERROR",
                        message: "Failed to upload files",
                        details: err instanceof Error ? err.message : "Unknown error",
                        suggestedAction: "Check server logs for details",
                    });
                }
                const uploaded = req.files;
                if (!uploaded || uploaded.length === 0) {
                    return res.status(400).json({
                        code: "NO_FILE",
                        message: "No files uploaded",
                        suggestedAction: "Select files to upload",
                    });
                }
                let filePaths;
                try {
                    const raw = req.body?.filePaths;
                    if (typeof raw === "string")
                        filePaths = JSON.parse(raw);
                }
                catch {
                    filePaths = undefined;
                }
                const baseDir = resolvedPath;
                for (let i = 0; i < uploaded.length; i++) {
                    const file = uploaded[i];
                    if (!file)
                        continue;
                    const explicitPath = filePaths?.[i];
                    const relativePath = typeof explicitPath === "string"
                        ? explicitPath
                        : (file.originalname || "").replace(/\\/g, "/");
                    const safeRelative = sanitizeRelativePath(relativePath);
                    if (!safeRelative)
                        continue;
                    const fullPath = path.resolve(baseDir, safeRelative);
                    if (!fullPath.startsWith(resolvedRoot)) {
                        return res.status(400).json({
                            code: "PATH_TRAVERSAL_DETECTED",
                            message: "Invalid path or filename",
                            suggestedAction: "Try again",
                        });
                    }
                    try {
                        fs.mkdirSync(path.dirname(fullPath), { recursive: true, mode: 0o755 });
                        fs.writeFileSync(fullPath, file.buffer, { mode: 0o644 });
                    }
                    catch (e) {
                        logger.error("[FileManager] Write failed", fullPath, e);
                        return res.status(500).json({
                            code: "UPLOAD_ERROR",
                            message: "Failed to write file",
                            details: e instanceof Error ? e.message : "Unknown error",
                            suggestedAction: "Check server logs",
                        });
                    }
                }
                logger.info(`[FileManager] Upload done: serverId=${id}, path="${rawPath}", files=${uploaded.length}, paths=${filePaths ? "yes" : "originalname"}`);
                const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
                const result = entries
                    .map((e) => {
                    const entryPath = path.join(resolvedPath, e.name);
                    const resolvedEntryPath = path.resolve(entryPath);
                    if (!resolvedEntryPath.startsWith(resolvedRoot))
                        return null;
                    try {
                        const lstats = fs.lstatSync(entryPath);
                        return {
                            name: e.name,
                            size: lstats.isFile() ? lstats.size : 0,
                            modified: lstats.mtime.toISOString(),
                            isDirectory: lstats.isDirectory(),
                        };
                    }
                    catch {
                        return null;
                    }
                })
                    .filter(Boolean);
                result.sort((a, b) => {
                    if (a.isDirectory !== b.isDirectory)
                        return a.isDirectory ? -1 : 1;
                    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
                });
                return res.status(201).json({ path: rawPath || "", entries: result });
            });
        }
        catch (error) {
            if (error instanceof HypanelError) {
                return res.status(error.statusCode).json(error.toJSON());
            }
            res.status(500).json({
                code: "INTERNAL_ERROR",
                message: "Failed to upload file",
                details: error instanceof Error ? error.message : "Unknown error",
                suggestedAction: "Check server logs for details",
            });
        }
    });
    // DELETE /api/servers/:id/files - Delete file or empty directory (query path = relative path to file/dir)
    router.delete("/:id/files", validateParams(serverIdSchema), (req, res) => {
        try {
            const pathParam = req.query.path ?? "";
            if (!pathParam) {
                return res.status(400).json({
                    code: "PATH_REQUIRED",
                    message: "Query parameter 'path' is required for delete",
                    suggestedAction: "Specify the relative path to the file or directory",
                });
            }
            const { id } = req.params;
            logger.info(`[FileManager] Delete start: serverId=${id}, path="${pathParam}"`);
            const dbServer = getServerFromDb(id);
            if (!dbServer) {
                return res.status(404).json({
                    code: "SERVER_NOT_FOUND",
                    message: `Server ${id} not found`,
                    suggestedAction: "Verify the server ID is correct",
                });
            }
            const serverRoot = dbServer.serverRoot || path.join(config.serversDir, id);
            let resolvedPath;
            let resolvedRoot;
            try {
                const out = resolveServerPath(serverRoot, pathParam);
                resolvedPath = out.resolvedPath;
                resolvedRoot = out.resolvedRoot;
            }
            catch (e) {
                return res.status(400).json({
                    code: "PATH_TRAVERSAL_DETECTED",
                    message: "Invalid path",
                    suggestedAction: "Use a path within the server directory",
                });
            }
            if (resolvedPath === resolvedRoot) {
                return res.status(400).json({
                    code: "CANNOT_DELETE_ROOT",
                    message: "Cannot delete the server root directory",
                    suggestedAction: "Delete individual files or folders instead",
                });
            }
            if (!fs.existsSync(resolvedPath)) {
                return res.status(404).json({
                    code: "NOT_FOUND",
                    message: "File or directory not found",
                    suggestedAction: "Refresh the file list",
                });
            }
            const stat = fs.statSync(resolvedPath);
            const isDir = stat.isDirectory();
            if (isDir) {
                fs.rmSync(resolvedPath, { recursive: true, force: true });
            }
            else {
                fs.unlinkSync(resolvedPath);
            }
            logger.info(`[FileManager] Delete done: serverId=${id}, path="${pathParam}", type=${isDir ? "directory" : "file"}`);
            return res.status(204).send();
        }
        catch (error) {
            logger.error(`[FileManager] Delete error: serverId=${req.params.id}, path="${req.query.path}"`, error);
            if (res.headersSent)
                return;
            if (error instanceof HypanelError) {
                return res.status(error.statusCode).json(error.toJSON());
            }
            res.status(500).json({
                code: "INTERNAL_ERROR",
                message: "Failed to delete",
                details: error instanceof Error ? error.message : "Unknown error",
                suggestedAction: "Check server logs for details",
            });
        }
    });
    // GET /api/servers/:id/files/download - Download file (query path = relative path to file)
    router.get("/:id/files/download", validateParams(serverIdSchema), (req, res) => {
        try {
            const pathParam = req.query.path ?? "";
            if (!pathParam) {
                return res.status(400).json({
                    code: "PATH_REQUIRED",
                    message: "Query parameter 'path' is required for download",
                    suggestedAction: "Specify the relative path to the file",
                });
            }
            const { id } = req.params;
            logger.info(`[FileManager] Download start: serverId=${id}, path="${pathParam}"`);
            const dbServer = getServerFromDb(id);
            if (!dbServer) {
                return res.status(404).json({
                    code: "SERVER_NOT_FOUND",
                    message: `Server ${id} not found`,
                    suggestedAction: "Verify the server ID is correct",
                });
            }
            const serverRoot = dbServer.serverRoot || path.join(config.serversDir, id);
            let resolvedPath;
            let resolvedRoot;
            try {
                const out = resolveServerPath(serverRoot, pathParam);
                resolvedPath = out.resolvedPath;
                resolvedRoot = out.resolvedRoot;
            }
            catch (e) {
                return res.status(400).json({
                    code: "PATH_TRAVERSAL_DETECTED",
                    message: "Invalid path",
                    suggestedAction: "Use a path within the server directory",
                });
            }
            if (!fs.existsSync(resolvedPath)) {
                return res.status(404).json({
                    code: "NOT_FOUND",
                    message: "File not found",
                    suggestedAction: "Check the path",
                });
            }
            const stat = fs.statSync(resolvedPath);
            if (!stat.isFile()) {
                return res.status(400).json({
                    code: "NOT_A_FILE",
                    message: "Path is not a file",
                    suggestedAction: "Download a file, not a directory",
                });
            }
            const filename = path.basename(resolvedPath);
            res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, '\\"')}"`);
            res.sendFile(resolvedPath, (err) => {
                if (err && !res.headersSent) {
                    res.status(500).json({
                        code: "INTERNAL_ERROR",
                        message: "Failed to send file",
                        suggestedAction: "Try again",
                    });
                }
            });
        }
        catch (error) {
            if (error instanceof HypanelError) {
                return res.status(error.statusCode).json(error.toJSON());
            }
            res.status(500).json({
                code: "INTERNAL_ERROR",
                message: "Failed to download file",
                details: error instanceof Error ? error.message : "Unknown error",
                suggestedAction: "Check server logs for details",
            });
        }
    });
    // Generic /:id routes must come AFTER all specific /:id/... routes
    // GET /api/servers/:id - Get server details
    router.get("/:id", validateParams(serverIdSchema), (req, res) => {
        try {
            const { id } = req.params;
            const server = serverManager.getServer(id);
            if (!server) {
                return res.status(404).json({ error: "Server not found" });
            }
            res.json(server);
        }
        catch (error) {
            if (error instanceof HypanelError) {
                return res.status(error.statusCode).json(error.toJSON());
            }
            res.status(500).json({
                code: "INTERNAL_ERROR",
                message: "Failed to get server",
                suggestedAction: "Check server logs for details"
            });
        }
    });
    // PUT /api/servers/:id - Update server configuration
    router.put("/:id", validateParams(serverIdSchema), validateBody(updateServerSchema), async (req, res) => {
        try {
            const { id } = req.params;
            const server = await serverManager.updateServerConfig(id, req.body);
            res.json(server);
        }
        catch (error) {
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
    });
    // POST /api/servers/:id/check-update - Check if server update is available
    router.post("/:id/check-update", validateParams(serverIdSchema), async (req, res) => {
        try {
            const { id } = req.params;
            const result = await serverManager.checkServerUpdate(id);
            res.json(result);
        }
        catch (error) {
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
                message: "Failed to check for updates",
                details: error instanceof Error ? error.message : "Unknown error",
                suggestedAction: "Check server logs for details"
            });
        }
    });
    // POST /api/servers/:id/update - Update server to latest version
    router.post("/:id/update", validateParams(serverIdSchema), async (req, res) => {
        try {
            const { id } = req.params;
            await serverManager.updateServer(id);
            const server = serverManager.getServer(id);
            res.json({
                success: true,
                message: "Server updated successfully",
                server
            });
        }
        catch (error) {
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
    });
    // DELETE /api/servers/:id - Delete server
    router.delete("/:id", validateParams(serverIdSchema), async (req, res) => {
        try {
            const { id } = req.params;
            await serverManager.deleteServer(id);
            res.status(204).send();
        }
        catch (error) {
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
    });
    return router;
}
//# sourceMappingURL=servers.js.map