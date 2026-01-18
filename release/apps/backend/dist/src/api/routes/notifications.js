import { Router } from "express";
import { clearNotifications, getNotifications } from "../../database/db.js";
export function createNotificationRoutes() {
    const router = Router();
    // GET /api/notifications?limit=50
    router.get("/", (req, res) => {
        const limitRaw = req.query.limit;
        const limit = typeof limitRaw === "string" && limitRaw.trim() !== ""
            ? Number.parseInt(limitRaw, 10)
            : 50;
        const notifications = getNotifications(Number.isFinite(limit) ? limit : 50);
        res.json(notifications);
    });
    // DELETE /api/notifications - Clear all notifications
    router.delete("/", (_req, res) => {
        clearNotifications();
        res.json({ success: true });
    });
    return router;
}
//# sourceMappingURL=notifications.js.map