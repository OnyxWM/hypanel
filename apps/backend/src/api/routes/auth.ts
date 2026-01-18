import { Router } from "express";
import { validateBody } from "../middleware/validation.js";
import { handleLogin, handleLogout, requireAuth, loginBodySchema } from "../middleware/auth.js";

export function createAuthRoutes(): Router {
  const router = Router();

  // POST /api/auth/login
  router.post("/login", validateBody(loginBodySchema), async (req, res) => {
    await handleLogin(req, res);
  });

  // POST /api/auth/logout
  router.post("/logout", (req, res) => {
    handleLogout(req, res);
  });

  // GET /api/auth/me
  router.get("/me", requireAuth, (req, res) => {
    const auth = (req as any).auth as { username: string } | undefined;
    res.json({ authenticated: true, user: { username: auth?.username || "hypanel" } });
  });

  return router;
}
