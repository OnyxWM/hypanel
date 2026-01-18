import { Router, Request, Response } from "express";
import { z } from "zod";
import { getServerStats } from "../../database/db.js";
import { validateParams } from "../middleware/validation.js";

const serverIdSchema = z.object({
  id: z.string().min(1),
});

export function createStatsRoutes(): Router {
  const router = Router();

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

  return router;
}
