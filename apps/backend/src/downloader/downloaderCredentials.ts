import fs from "fs";
import { config } from "../config/config.js";
import { logger } from "../logger/Logger.js";

export interface OAuthState {
  processId: string;
  url: string;
  code: string;
  status: "pending" | "authenticated" | "failed";
  createdAt: number;
  stdout: string;
  stderr: string;
}

let oauthState: OAuthState | null = null;

const directCredentialFailurePatterns = [
  /invalid[_ -]?grant/i,
  /invalid[_ -]?token/i,
  /token[_ -]?expired/i,
  /expired[_ -]?token/i,
  /refresh token/i,
  /authentication failed/i,
  /authorization failed/i,
  /unauthorized/i,
  /credentials?.*(expired|invalid)/i,
  /(expired|invalid).*(credentials?|token)/i,
];

const authContextTerms = [
  "auth",
  "authoriz",
  "token",
  "credential",
  "oauth",
  "grant",
  "login",
  "expired",
  "refresh",
];

export function getOAuthState(): OAuthState | null {
  return oauthState;
}

export function setOAuthState(state: OAuthState | null): void {
  oauthState = state;
}

export async function clearDownloaderCredentials(): Promise<boolean> {
  oauthState = null;

  const credentialsPath = config.downloaderCredentialsPath;
  if (!credentialsPath) {
    logger.warn("Downloader credentials path is not configured; only cleared in-memory OAuth state");
    return false;
  }

  try {
    await fs.promises.unlink(credentialsPath);
    logger.info(`Cleared downloader credentials at ${credentialsPath}`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      logger.info(`Downloader credentials already absent at ${credentialsPath}`);
      return false;
    }

    logger.error(
      `Failed to clear downloader credentials at ${credentialsPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw error;
  }
}

export function isLikelyCredentialAuthFailure(text: string): boolean {
  const normalized = text.toLowerCase();
  if (!normalized.trim()) {
    return false;
  }

  if (directCredentialFailurePatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const has401 = /\b401\b/.test(normalized);
  return has401 && authContextTerms.some((term) => normalized.includes(term));
}
