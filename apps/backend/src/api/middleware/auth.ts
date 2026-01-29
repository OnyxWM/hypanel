import type { Request, Response, NextFunction } from "express";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { logger } from "../../logger/Logger.js";
import bcrypt from "bcrypt";
import { timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "hypanel_session";

// `authenticate-pam` is a native addon; load via CJS require to avoid Node ESM
// attempting to `import` the `.node` binary directly.
// Load PAM conditionally - it may not be available in all environments (e.g., Docker)
let pam: {
  authenticate: (username: string, password: string, cb: (err?: unknown) => void) => void;
} | null = null;

try {
  const require = createRequire(import.meta.url);
  pam = require("authenticate-pam");
} catch (err) {
  logger.warn("PAM module not available - ENV authentication mode will be required");
}

type Session = {
  id: string;
  username: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
};

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const sessions = new Map<string, Session>();

type RateLimitState = { resetAt: number; count: number };
const loginRateLimit = new Map<string, RateLimitState>();
const LOGIN_WINDOW_MS = 60 * 1000; // 1 minute
const LOGIN_MAX_ATTEMPTS = 10;

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const rawVal = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rawVal);
    } catch {
      out[key] = rawVal;
    }
  }
  return out;
}

function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  }
  return req.socket.remoteAddress || "unknown";
}

function cleanupExpiredSessions(now: number): void {
  for (const [id, sess] of sessions) {
    if (sess.expiresAt <= now) {
      sessions.delete(id);
    }
  }
}

export function getSessionFromCookieHeader(cookieHeader: string | undefined): Session | null {
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) return null;

  const now = Date.now();
  cleanupExpiredSessions(now);
  const sess = sessions.get(sessionId);
  if (!sess) return null;
  if (sess.expiresAt <= now) {
    sessions.delete(sessionId);
    return null;
  }
  sess.lastSeenAt = now;
  return sess;
}

export function getSessionById(sessionId: string): Session | null {
  if (!sessionId) return null;
  const now = Date.now();
  cleanupExpiredSessions(now);
  const sess = sessions.get(sessionId);
  if (!sess) return null;
  if (sess.expiresAt <= now) {
    sessions.delete(sessionId);
    return null;
  }
  sess.lastSeenAt = now;
  return sess;
}

function setSessionCookie(res: Response, input: { sessionId: string; maxAgeMs: number; isSecure: boolean }): void {
  const maxAgeSeconds = Math.floor(input.maxAgeMs / 1000);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(input.sessionId)}`,
    `Path=/`,
    `HttpOnly`,
    `Max-Age=${maxAgeSeconds}`,
    `SameSite=Lax`,
  ];
  if (input.isSecure) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: Response, input: { isSecure: boolean }): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    `Path=/`,
    `HttpOnly`,
    `Max-Age=0`,
    `SameSite=Lax`,
  ];
  if (input.isSecure) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

function isRequestSecure(req: Request): boolean {
  if (req.secure) return true;
  const xfp = req.headers["x-forwarded-proto"];
  if (typeof xfp === "string" && xfp.toLowerCase() === "https") return true;
  return false;
}

export async function authenticateOsUser(username: string, password: string): Promise<void> {
  const authMethod = process.env.HYPANEL_AUTH_METHOD || "PAM";
  
  if (authMethod === "ENV") {
    // ENV authentication mode
    let passwordHash: string | undefined = process.env.HYPANEL_PASSWORD_HASH;
    const hashFile = process.env.HYPANEL_PASSWORD_HASH_FILE;
    if (hashFile) {
      try {
        const content = readFileSync(hashFile, "utf8").trim();
        if (content) passwordHash = content;
      } catch (err) {
        logger.warn(`Failed to read HYPANEL_PASSWORD_HASH_FILE=${hashFile}: ${err instanceof Error ? err.message : String(err)}`);
        throw new Error("Invalid password");
      }
    }
    const passwordPlain = process.env.HYPANEL_PASSWORD;

    if (passwordHash) {
      // Precedence 1: Use bcrypt hash verification (recommended)
      const isValid = await bcrypt.compare(password, passwordHash);
      if (!isValid) {
        throw new Error("Invalid password");
      }
      return;
    } else if (passwordPlain) {
      // Precedence 2: Use constant-time comparison for plaintext (testing only)
      // Convert both to buffers for constant-time comparison
      const providedBuffer = Buffer.from(password, "utf8");
      const expectedBuffer = Buffer.from(passwordPlain, "utf8");
      
      // Ensure buffers are same length to prevent timing attacks
      if (providedBuffer.length !== expectedBuffer.length) {
        throw new Error("Invalid password");
      }
      
      const isValid = timingSafeEqual(providedBuffer, expectedBuffer);
      if (!isValid) {
        throw new Error("Invalid password");
      }
      return;
    } else {
      // Precedence 3: Fail-fast - no credentials provided
      throw new Error("HYPANEL_AUTH_METHOD=ENV requires HYPANEL_PASSWORD_HASH, HYPANEL_PASSWORD_HASH_FILE, or HYPANEL_PASSWORD to be set");
    }
  } else {
    // PAM authentication mode (default)
    if (!pam) {
      throw new Error("PAM authentication is not available. Set HYPANEL_AUTH_METHOD=ENV to use environment-based authentication.");
    }
    
    await new Promise<void>((resolve, reject) => {
      pam!.authenticate(username, password, (err: any) => {
        if (err) return reject(err);
        return resolve();
      });
    });
  }
}

export const loginBodySchema = z.object({
  username: z.string().optional(),
  password: z.string().min(1),
});

export async function handleLogin(req: Request, res: Response): Promise<void> {
  const ip = getClientIp(req);
  const now = Date.now();

  const rl = loginRateLimit.get(ip);
  if (rl && now < rl.resetAt && rl.count >= LOGIN_MAX_ATTEMPTS) {
    res.status(429).json({ error: "Too many login attempts. Please try again shortly." });
    return;
  }

  const body = loginBodySchema.parse(req.body);
  const username = body.username?.trim() || "hypanel";
  if (username !== "hypanel") {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  try {
    await authenticateOsUser(username, body.password);
  } catch (err) {
    const nextRl: RateLimitState = rl && now < rl.resetAt
      ? { resetAt: rl.resetAt, count: rl.count + 1 }
      : { resetAt: now + LOGIN_WINDOW_MS, count: 1 };
    loginRateLimit.set(ip, nextRl);

    // Avoid leaking PAM error details to clients
    logger.warn(`Web login failed for ${username} from ${ip}: ${err instanceof Error ? err.message : String(err)}`);
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  // Successful login: clear rate limit state
  loginRateLimit.delete(ip);
  cleanupExpiredSessions(now);

  const sessionId = uuidv4();
  const sess: Session = {
    id: sessionId,
    username,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(sessionId, sess);

  const isSecure = process.env.NODE_ENV === "production" ? isRequestSecure(req) : false;
  setSessionCookie(res, { sessionId, maxAgeMs: SESSION_TTL_MS, isSecure });
  res.json({ ok: true, user: { username } });
}

export function handleLogout(req: Request, res: Response): void {
  const cookieHeader = req.headers.cookie;
  const sess = getSessionFromCookieHeader(cookieHeader);
  if (sess) {
    sessions.delete(sess.id);
  }
  const isSecure = process.env.NODE_ENV === "production" ? isRequestSecure(req) : false;
  clearSessionCookie(res, { isSecure });
  res.json({ ok: true });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const sess = getSessionFromCookieHeader(req.headers.cookie);
  if (!sess) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as any).auth = { username: sess.username, sessionId: sess.id };
  next();
}
