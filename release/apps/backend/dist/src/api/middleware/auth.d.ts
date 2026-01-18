import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
export declare const SESSION_COOKIE_NAME = "hypanel_session";
type Session = {
    id: string;
    username: string;
    createdAt: number;
    expiresAt: number;
    lastSeenAt: number;
};
export declare function getSessionFromCookieHeader(cookieHeader: string | undefined): Session | null;
export declare function getSessionById(sessionId: string): Session | null;
export declare function clearSessionCookie(res: Response, input: {
    isSecure: boolean;
}): void;
export declare function authenticateOsUser(username: string, password: string): Promise<void>;
export declare const loginBodySchema: z.ZodObject<{
    username: z.ZodOptional<z.ZodString>;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    password: string;
    username?: string | undefined;
}, {
    password: string;
    username?: string | undefined;
}>;
export declare function handleLogin(req: Request, res: Response): Promise<void>;
export declare function handleLogout(req: Request, res: Response): void;
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
export {};
//# sourceMappingURL=auth.d.ts.map