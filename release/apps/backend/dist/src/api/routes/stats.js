import { Router } from "express";
import { z } from "zod";
import { getServerStats } from "../../database/db.js";
import { validateParams } from "../middleware/validation.js";
const serverIdSchema = z.object({
    id: z.string().min(1),
});
export function createStatsRoutes() {
    const router = Router();
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
    return router;
}
//# sourceMappingURL=stats.js.map