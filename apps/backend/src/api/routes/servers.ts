import { Router, Request, Response } from "express";
import { z } from "zod";
import { ServerManager } from "../../server/ServerManager.js";
import { getConsoleLogs } from "../../database/db.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import fs from "fs";
import path from "path";

const createServerSchema = z.object({
  name: z.string().min(1).max(100),
  path: z.string().min(1),
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
});

const serverIdSchema = z.object({
  id: z.string().uuid(),
});

const commandSchema = z.object({
  command: z.string().min(1),
});

const updateServerSchema = createServerSchema.partial();

const hytaleConfigSchema = z.object({
  ServerName: z.string().min(1).max(100),
  MOTD: z.string().optional(),
  Password: z.string().optional(),
  MaxPlayers: z.number().int().positive().max(1000).default(20),
  MaxViewRadius: z.number().int().positive().max(32).default(10),
  LocalCompressionEnabled: z.boolean().default(true),
  Defaults: z.object({
    World: z.string().optional(),
    GameMode: z.enum(["survival", "creative", "adventure", "spectator"]).default("survival"),
  }).optional(),
}).partial();

const worldConfigSchema = z.object({
  IsPvpEnabled: z.boolean().optional(),
  IsFallDamageEnabled: z.boolean().optional(),
  IsGameTimePaused: z.boolean().optional(),
  IsSpawningNPC: z.boolean().optional(),
  Seed: z.number().int().optional(),
  SaveNewChunks: z.boolean().optional(),
  IsUnloadingChunks: z.boolean().optional(),
}).partial();

const worldNameSchema = z.object({
  world: z.string().min(1).max(100),
});

export function createServerRoutes(serverManager: ServerManager): Router {
  const router = Router();

  // GET /api/servers - List all servers
  router.get("/", (req: Request, res: Response) => {
    try {
      const servers = serverManager.getAllServers();
      res.json(servers);
    } catch (error) {
      res.status(500).json({ error: "Failed to get servers" });
    }
  });

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
        res.status(500).json({ error: "Failed to get server" });
      }
    }
  );

  // POST /api/servers - Create new server
  router.post(
    "/",
    validateBody(createServerSchema),
    async (req: Request, res: Response) => {
      try {
        const server = await serverManager.createServer(req.body);
        res.status(201).json(server);
      } catch (error) {
        res.status(500).json({
          error: "Failed to create server",
          message: error instanceof Error ? error.message : "Unknown error",
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
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(500).json({
          error: "Failed to update server",
          message: error instanceof Error ? error.message : "Unknown error",
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
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to delete server" });
      }
    }
  );

  // POST /api/servers/:id/start - Start server
  router.post(
    "/:id/start",
    validateParams(serverIdSchema),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params as { id: string };
        await serverManager.startServer(id);
        const server = serverManager.getServer(id);
        res.json(server);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(500).json({
          error: "Failed to start server",
          message: error instanceof Error ? error.message : "Unknown error",
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
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(500).json({
          error: "Failed to stop server",
          message: error instanceof Error ? error.message : "Unknown error",
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
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(500).json({
          error: "Failed to restart server",
          message: error instanceof Error ? error.message : "Unknown error",
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
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(500).json({
          error: "Failed to send command",
          message: error instanceof Error ? error.message : "Unknown error",
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
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        if (error instanceof Error && (
          error.message.includes("already installed") ||
          error.message.includes("already in progress")
        )) {
          return res.status(409).json({
            error: "Installation conflict",
            message: error.message,
          });
        }
        res.status(500).json({
          error: "Failed to start installation",
          message: error instanceof Error ? error.message : "Unknown error",
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
        const limit = req.query.limit
          ? parseInt(req.query.limit as string, 10)
          : 1000;
        const logs = getConsoleLogs(id, limit);
        res.json(logs);
      } catch (error) {
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
        const server = serverManager.getServer(id);
        if (!server) {
          return res.status(404).json({ error: "Server not found" });
        }

        // Get the server root directory
        const serverRoot = server.serverRoot;
        if (!serverRoot) {
          return res.status(400).json({ 
            error: "Server root not configured",
            message: "Server must be installed before accessing config"
          });
        }

        const configPath = path.join(serverRoot, "config.json");
        
        // Check if config file exists
        if (!fs.existsSync(configPath)) {
          return res.status(404).json({ 
            error: "Config file not found",
            message: "config.json does not exist in server directory"
          });
        }

        // Read and parse config file
        try {
          const configContent = fs.readFileSync(configPath, "utf-8");
          const config = JSON.parse(configContent);
          res.json(config);
        } catch (parseError) {
          res.status(500).json({ 
            error: "Failed to parse config file",
            message: "config.json is invalid or corrupted"
          });
        }
      } catch (error) {
        res.status(500).json({ error: "Failed to get server config" });
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
        const server = serverManager.getServer(id);
        if (!server) {
          return res.status(404).json({ error: "Server not found" });
        }

        // Prevent config changes while server is running
        if (server.status === "online" || server.status === "starting") {
          return res.status(409).json({ 
            error: "Server must be stopped",
            message: "Cannot modify config while server is running. Stop the server first."
          });
        }

        // Get the server root directory
        const serverRoot = server.serverRoot;
        if (!serverRoot) {
          return res.status(400).json({ 
            error: "Server root not configured",
            message: "Server must be installed before updating config"
          });
        }

        const configPath = path.join(serverRoot, "config.json");
        
        // Load existing config to merge with updates
        let existingConfig: any = {};
        if (fs.existsSync(configPath)) {
          try {
            const existingContent = fs.readFileSync(configPath, "utf-8");
            existingConfig = JSON.parse(existingContent);
          } catch (parseError) {
            return res.status(500).json({ 
              error: "Failed to parse existing config",
              message: "Existing config.json is invalid or corrupted"
            });
          }
        }

        // Merge updates with existing config
        const updatedConfig = { ...existingConfig, ...req.body };

        // Validate the merged config is valid JSON
        try {
          const configContent = JSON.stringify(updatedConfig, null, 2);
          
          // Write to temporary file first, then rename to prevent corruption
          const tempPath = configPath + ".tmp";
          fs.writeFileSync(tempPath, configContent, "utf-8");
          fs.renameSync(tempPath, configPath);
          
          res.json({ 
            success: true, 
            message: "Config updated successfully",
            config: updatedConfig 
          });
        } catch (writeError) {
          res.status(500).json({ 
            error: "Failed to write config file",
            message: "Unable to save config changes"
          });
        }
      } catch (error) {
        res.status(500).json({ error: "Failed to update server config" });
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
        const server = serverManager.getServer(id);
        if (!server) {
          return res.status(404).json({ error: "Server not found" });
        }

        const worlds = serverManager.getWorlds(id);
        res.json(worlds);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to get worlds" });
      }
    }
  );

  // GET /api/servers/:id/worlds/:world/config - Get world config.json
  router.get(
    "/:id/worlds/:world/config",
    (req: Request, res: Response) => {
      try {
        // Validate params manually since we have conflicting schemas
        const idSchema = serverIdSchema.parse({ id: req.params.id });
        const worldSchema = worldNameSchema.parse({ world: req.params.world });
        const { id, world } = { ...idSchema, ...worldSchema };
        
        const server = serverManager.getServer(id);
        if (!server) {
          return res.status(404).json({ error: "Server not found" });
        }

        const config = serverManager.getWorldConfig(id, world);
        res.json(config);
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
    validateBody(worldConfigSchema),
    (req: Request, res: Response) => {
      try {
        // Validate params manually since we have conflicting schemas
        const idSchema = serverIdSchema.parse({ id: req.params.id });
        const worldSchema = worldNameSchema.parse({ world: req.params.world });
        const { id, world } = { ...idSchema, ...worldSchema };
        
        const server = serverManager.getServer(id);
        if (!server) {
          return res.status(404).json({ error: "Server not found" });
        }

        // Prevent config changes while server is running
        if (server.status === "online" || server.status === "starting") {
          return res.status(409).json({ 
            error: "Server must be stopped",
            message: "Cannot modify world config while server is running. Stop the server first."
          });
        }

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

  return router;
}
