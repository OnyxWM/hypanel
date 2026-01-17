import { Router, Request, Response } from "express";
import { z } from "zod";
import { ServerManager } from "../../server/ServerManager.js";
import { getConsoleLogs } from "../../database/db.js";
import { validateBody, validateParams } from "../middleware/validation.js";

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

  return router;
}
