import { createRequire } from "module";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { logger } from "../../logger/Logger.js";
export const SESSION_COOKIE_NAME = "hypanel_session";
// `authenticate-pam` is a native addon; load via CJS require to avoid Node ESM
// attempting to `import` the `.node` binary directly.
const require = createRequire(import.meta.url);
const pam = require("authenticate-pam");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const sessions = new Map();
const loginRateLimit = new Map();
const LOGIN_WINDOW_MS = 60 * 1000; // 1 minute
const LOGIN_MAX_ATTEMPTS = 10;
function parseCookies(cookieHeader) {
    if (!cookieHeader)
        return {};
    const out = {};
    const parts = cookieHeader.split(";");
    for (const part of parts) {
        const idx = part.indexOf("=");
        if (idx === -1)
            continue;
        const key = part.slice(0, idx).trim();
        const rawVal = part.slice(idx + 1).trim();
        if (!key)
            continue;
        try {
            out[key] = decodeURIComponent(rawVal);
        }
        catch {
            out[key] = rawVal;
        }
    }
    return out;
}
function getClientIp(req) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
        return xff.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    }
    return req.socket.remoteAddress || "unknown";
}
function cleanupExpiredSessions(now) {
    for (const [id, sess] of sessions) {
        if (sess.expiresAt <= now) {
            sessions.delete(id);
        }
    }
}
export function getSessionFromCookieHeader(cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    const sessionId = cookies[SESSION_COOKIE_NAME];
    if (!sessionId)
        return null;
    const now = Date.now();
    cleanupExpiredSessions(now);
    const sess = sessions.get(sessionId);
    if (!sess)
        return null;
    if (sess.expiresAt <= now) {
        sessions.delete(sessionId);
        return null;
    }
    sess.lastSeenAt = now;
    return sess;
}
export function getSessionById(sessionId) {
    if (!sessionId)
        return null;
    const now = Date.now();
    cleanupExpiredSessions(now);
    const sess = sessions.get(sessionId);
    if (!sess)
        return null;
    if (sess.expiresAt <= now) {
        sessions.delete(sessionId);
        return null;
    }
    sess.lastSeenAt = now;
    return sess;
}
function setSessionCookie(res, input) {
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
export function clearSessionCookie(res, input) {
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
function isRequestSecure(req) {
    if (req.secure)
        return true;
    const xfp = req.headers["x-forwarded-proto"];
    if (typeof xfp === "string" && xfp.toLowerCase() === "https")
        return true;
    return false;
}
export async function authenticateOsUser(username, password) {
    await new Promise((resolve, reject) => {
        pam.authenticate(username, password, (err) => {
            if (err)
                return reject(err);
            return resolve();
        });
    });
}
export const loginBodySchema = z.object({
    username: z.string().optional(),
    password: z.string().min(1),
});
export async function handleLogin(req, res) {
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
    }
    catch (err) {
        const nextRl = rl && now < rl.resetAt
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
    const sess = {
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
export function handleLogout(req, res) {
    const cookieHeader = req.headers.cookie;
    const sess = getSessionFromCookieHeader(cookieHeader);
    if (sess) {
        sessions.delete(sess.id);
    }
    const isSecure = process.env.NODE_ENV === "production" ? isRequestSecure(req) : false;
    clearSessionCookie(res, { isSecure });
    res.json({ ok: true });
}
export function requireAuth(req, res, next) {
    const sess = getSessionFromCookieHeader(req.headers.cookie);
    if (!sess) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    req.auth = { username: sess.username, sessionId: sess.id };
    next();
}
//# sourceMappingURL=auth.js.map