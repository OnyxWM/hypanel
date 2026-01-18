import { Router, Request, Response } from "express";
import { clearNotifications, getNotifications } from "../../database/db.js";

export function createNotificationRoutes(): Router {
  const router = Router();

  // GET /api/notifications?limit=50
  router.get("/", (req: Request, res: Response) => {
    const limitRaw = req.query.limit;
    const limit =
      typeof limitRaw === "string" && limitRaw.trim() !== ""
        ? Number.parseInt(limitRaw, 10)
        : 50;

    const notifications = getNotifications(Number.isFinite(limit) ? limit : 50);
    res.json(notifications);
  });

  // DELETE /api/notifications - Clear all notifications
  router.delete("/", (_req: Request, res: Response) => {
    clearNotifications();
    res.json({ success: true });
  });

  return router;
}

