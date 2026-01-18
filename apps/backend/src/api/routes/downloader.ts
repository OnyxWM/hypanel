import { Router, Request, Response } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { config } from "../../config/config.js";
import { logger } from "../../logger/Logger.js";

const router = Router();

interface OAuthState {
  processId: string;
  url: string;
  code: string;
  status: "pending" | "authenticated" | "failed";
  createdAt: number;
  stdout: string;
  stderr: string;
}

let oauthState: OAuthState | null = null;

function parseOAuthOutput(output: string): { url?: string; code?: string } {
  const urlMatch = output.match(/https:\/\/oauth\.accounts\.hytale\.com\/oauth2\/device\/verify[^\s\n]*/);
  
  // Try to extract code from "Authorization code:" line (might be on same or next line)
  const codeMatch = output.match(/Authorization\s+code:\s*([A-Z0-9]+(?:\s+[A-Z0-9]+)*)/i);
  
  let url = urlMatch ? urlMatch[0].trim() : undefined;
  let code = codeMatch && codeMatch[1] ? codeMatch[1].replace(/\s+/g, '') : undefined;
  
  // Fallback: extract code from URL's user_code parameter
  if (url && !code) {
    const userCodeMatch = url.match(/user_code=([A-Z0-9]+)/i);
    if (userCodeMatch && userCodeMatch[1]) {
      code = userCodeMatch[1];
    }
  }
  
  // Additional fallback: if code still not found and URL exists, extract user_code with URL decoding
  if (url && !code) {
    try {
      const urlObj = new URL(url);
      const userCode = urlObj.searchParams.get('user_code');
      if (userCode) {
        code = userCode.toUpperCase();
      }
    } catch (e) {
      // URL parsing failed, ignore
    }
  }
  
  return {
    url,
    code,
  };
}

router.post("/auth/start", (req: Request, res: Response) => {
  try {
    const downloaderPath = "/opt/hytale-downloader/hytale-downloader";

    if (!fs.existsSync(downloaderPath)) {
      return res.status(404).json({
        code: "DOWNLOADER_NOT_FOUND",
        message: "hytale-downloader not found",
        suggestedAction: "Ensure hytale-downloader is installed at /opt/hytale-downloader/"
      });
    }

    logger.info("Starting hytale-downloader for OAuth authentication");

    const args = ["--skip-update-check"];
    
    // Add credentials path if configured to ensure writable location
    const credentialsPath = config.downloaderCredentialsPath;
    if (credentialsPath) {
      // Ensure the directory exists
      const credsDir = path.dirname(credentialsPath);
      if (!fs.existsSync(credsDir)) {
        fs.mkdirSync(credsDir, { recursive: true });
      }
      args.push("--credentials-path", credentialsPath);
      logger.debug(`Using credentials path: ${credentialsPath}`);
    }

    const process = spawn(downloaderPath, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    process.stdout?.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      logger.debug(`[downloader-auth] ${text}`);

      const parsed = parseOAuthOutput(text);
      
      // Update stdout/stderr in existing oauthState or create new one
      if (oauthState) {
        oauthState.stdout = stdout;
        oauthState.stderr = stderr;
      }
      
      if (parsed.url && parsed.code) {
        if (!oauthState) {
          oauthState = {
            processId: process.pid?.toString() || Date.now().toString(),
            url: parsed.url,
            code: parsed.code,
            status: "pending",
            createdAt: Date.now(),
            stdout: stdout,
            stderr: stderr
          };
        } else {
          // Update existing state with new url/code if found
          oauthState.url = parsed.url;
          oauthState.code = parsed.code;
        }
      }
    });

    process.stderr?.on("data", (data) => {
      stderr += data.toString();
      logger.debug(`[downloader-auth][error] ${data}`);
      
      // Update stderr in existing oauthState
      if (oauthState) {
        oauthState.stderr = stderr;
      }
    });

    process.on("error", (error) => {
      logger.error(`Downloader auth process error: ${error.message}`);
      oauthState = {
        processId: Date.now().toString(),
        url: "",
        code: "",
        status: "failed",
        createdAt: Date.now(),
        stdout: stdout,
        stderr: stderr
      };
    });

    process.on("close", (code) => {
      // Update output in oauthState when process closes
      if (oauthState) {
        oauthState.stdout = stdout;
        oauthState.stderr = stderr;
      }
      
      if (code === 0 && oauthState?.status === "pending") {
        oauthState.status = "authenticated";
      } else if (oauthState?.status === "pending") {
        oauthState.status = "failed";
      }
    });

    setTimeout(() => {
      if (!res.headersSent) {
        if (oauthState && oauthState.status === "pending") {
          return res.json({
            success: true,
            url: oauthState.url,
            code: oauthState.code,
            message: "Open the URL and enter the authorization code"
          });
        } else if (!oauthState) {
          return res.status(500).json({
            code: "NO_OAUTH_DATA",
            message: "Failed to capture OAuth credentials",
            details: stdout + stderr
          });
        }
      }
    }, 3000);

  } catch (error) {
    logger.error(`Failed to start downloader auth: ${error}`);
    res.status(500).json({
      code: "AUTH_START_FAILED",
      message: "Failed to start authentication",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

router.get("/auth/status", (req: Request, res: Response) => {
  // Check if credentials file exists (this is the real indicator of authentication)
  const credentialsPath = config.downloaderCredentialsPath;
  let credentialsExist = false;
  
  if (credentialsPath && fs.existsSync(credentialsPath)) {
    credentialsExist = true;
    // If credentials exist and we have a pending state, mark it as authenticated
    if (oauthState && oauthState.status === "pending") {
      oauthState.status = "authenticated";
    }
  }

  if (!oauthState) {
    // If credentials exist but no oauth state, user is authenticated
    if (credentialsExist) {
      return res.json({
        authenticated: true,
        status: "authenticated"
      });
    }
    return res.json({
      authenticated: false,
      status: "not_started"
    });
  }

  const isExpired = Date.now() - oauthState.createdAt > 600000;

  if (isExpired && oauthState.status === "pending") {
    oauthState = null;
    return res.json({
      authenticated: false,
      status: "expired"
    });
  }

  // If credentials exist, always return authenticated regardless of oauthState
  const isAuthenticated = credentialsExist || oauthState.status === "authenticated";

  res.json({
    authenticated: isAuthenticated,
    status: isAuthenticated ? "authenticated" : oauthState.status,
    code: oauthState.status === "pending" ? oauthState.code : undefined,
    stdout: oauthState.stdout || "",
    stderr: oauthState.stderr || ""
  });
});

router.post("/auth/complete", (req: Request, res: Response) => {
  const credentialsPath = config.downloaderCredentialsPath;

  if (!credentialsPath) {
    return res.status(500).json({
      code: "NO_CREDENTIALS_PATH",
      message: "Credentials path not configured"
    });
  }

  try {
    if (fs.existsSync(credentialsPath)) {
      oauthState = null;
      return res.json({
        success: true,
        message: "Downloader authenticated successfully"
      });
    } else {
      return res.status(404).json({
        code: "CREDENTIALS_NOT_FOUND",
        message: "Credentials file not found. Please complete OAuth authentication first."
      });
    }
  } catch (error) {
    res.status(500).json({
      code: "CHECK_FAILED",
      message: "Failed to verify credentials",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

router.post("/auth/cancel", (req: Request, res: Response) => {
  oauthState = null;
  res.json({
    success: true,
    message: "Authentication cancelled"
  });
});

export function createDownloaderRoutes() {
  return router;
}
