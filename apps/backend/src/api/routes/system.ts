import { Router, Request, Response } from "express";
import pidusage from "pidusage";
import os from "os";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { ServerManager } from "../../server/ServerManager.js";
import { HYPANEL_SYSTEMD_UNIT, queueRestartUnit, readUnitJournal } from "../../systemd/systemd.js";
import { getCurrentVersion, compareVersions } from "../../utils/version.js";

const execAsync = promisify(exec);

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  body: string | null;
  assets?: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
}

interface UpdateCheckCache {
  data: {
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    releaseUrl?: string;
    releaseNotes?: string;
    rateLimitRemaining?: number;
    rateLimitReset?: number;
    error?: string;
  };
  timestamp: number;
  expiresAt: number;
}

// In-memory cache for GitHub release data
let updateCheckCache: UpdateCheckCache | null = null;
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get the GitHub API URL for checking releases based on the configured channel.
 * Checks HYPANEL_UPDATE_CHANNEL or CHANNEL environment variables.
 * @returns Object with the API URL and the channel name used
 */
function getGitHubReleaseUrl(): { url: string; channel: string } {
  const channel = (process.env.HYPANEL_UPDATE_CHANNEL || process.env.CHANNEL || "stable")
    .toLowerCase()
    .trim();
  
  if (channel === "staging") {
    return {
      url: "https://api.github.com/repos/OnyxWm/hypanel/releases/tags/staging",
      channel: "staging",
    };
  }
  
  return {
    url: "https://api.github.com/repos/OnyxWm/hypanel/releases/latest",
    channel: "stable",
  };
}

export function createSystemRoutes(serverManager: ServerManager): Router {
  const router = Router();

  // GET /api/system/stats - Get aggregated system resource stats from all running servers
  router.get("/stats", async (req: Request, res: Response) => {
    try {
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const totalMemoryGB = totalMemory / 1024 / 1024 / 1024;
      const freeMemoryGB = freeMemory / 1024 / 1024 / 1024;
      
      // Aggregate CPU and memory from all running server instances
      let totalCpu = 0;
      let totalMemoryBytes = 0;
      
      // Get all servers and aggregate stats from online ones
      const allServers = serverManager.getAllServers();
      const serverPids: number[] = [];
      
      for (const server of allServers) {
        if (server.status === "online") {
          const instance = serverManager.getInstance(server.id);
          if (instance) {
            const process = instance.getProcess();
            if (process.pid) {
              serverPids.push(process.pid);
            }
          }
        }
      }
      
      // Get stats for all server processes
      if (serverPids.length > 0) {
        try {
          const statsObject = await pidusage(serverPids);
          // pidusage returns an object with PID as keys (may be string or number) when given an array
          for (const pid of serverPids) {
            const stat = statsObject[pid] || statsObject[pid.toString()];
            if (stat) {
              totalCpu += stat.cpu || 0;
              totalMemoryBytes += stat.memory || 0;
            }
          }
        } catch (error) {
          // If pidusage fails for all PIDs at once, try individually
          for (const pid of serverPids) {
            try {
              const stat = await pidusage(pid);
              totalCpu += stat.cpu || 0;
              totalMemoryBytes += stat.memory || 0;
            } catch (err) {
              // Process might have exited, skip it
              console.warn(`Failed to get stats for PID ${pid}: ${err}`);
            }
          }
        }
      }
      
      // Convert memory from bytes to GB
      const memoryGB = totalMemoryBytes / 1024 / 1024 / 1024;
      
      res.json({
        cpu: Math.round(totalCpu * 10) / 10, // Round to 1 decimal place
        memory: Math.round(memoryGB * 100) / 100, // Round to 2 decimal places
        totalMemory: Math.round(totalMemoryGB * 100) / 100,
        freeMemory: Math.round(freeMemoryGB * 100) / 100,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Failed to get system stats:", error);
      res.status(500).json({ error: "Failed to get system stats" });
    }
  });

  type ActionSummary = {
    requested: string[];
    succeeded: string[];
    failed: Array<{ id: string; error: string }>;
  };

  const summarize = (requested: string[], results: Array<{ id: string; ok: boolean; error?: string }>): ActionSummary => {
    const succeeded = results.filter((r) => r.ok).map((r) => r.id);
    const failed = results
      .filter((r) => !r.ok)
      .map((r) => ({ id: r.id, error: r.error || "Unknown error" }));
    return { requested, succeeded, failed };
  };

  // POST /api/system/servers/stop-all - Stop all servers (any non-offline status)
  router.post("/servers/stop-all", async (req: Request, res: Response) => {
    const force = req.query.force === "true";
    const servers = serverManager.getAllServers();
    const requested = servers.filter((s) => s.status !== "offline").map((s) => s.id);

    const settled = await Promise.allSettled(
      requested.map(async (id) => {
        await serverManager.stopServer(id, force);
        return id;
      })
    );

    const results = settled.map((r, idx) => {
      const id = requested[idx]!;
      if (r.status === "fulfilled") return { id, ok: true as const };
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      return { id, ok: false as const, error: msg };
    });

    res.json(summarize(requested, results));
  });

  // POST /api/system/servers/restart-online - Restart only servers currently online
  router.post("/servers/restart-online", async (req: Request, res: Response) => {
    const servers = serverManager.getAllServers();
    const requested = servers.filter((s) => s.status === "online").map((s) => s.id);

    const settled = await Promise.allSettled(
      requested.map(async (id) => {
        await serverManager.restartServer(id);
        return id;
      })
    );

    const results = settled.map((r, idx) => {
      const id = requested[idx]!;
      if (r.status === "fulfilled") return { id, ok: true as const };
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      return { id, ok: false as const, error: msg };
    });

    res.json(summarize(requested, results));
  });

  // POST /api/system/daemon/restart - Queue systemd restart of the hypanel service
  router.post("/daemon/restart", (req: Request, res: Response) => {
    // Return first, then restart shortly after to avoid killing the in-flight HTTP response.
    res.status(202).json({ queued: true, service: HYPANEL_SYSTEMD_UNIT });
    queueRestartUnit({ unit: HYPANEL_SYSTEMD_UNIT, delayMs: 250 });
  });

  // GET /api/system/journal - Read systemd journal entries for hypanel unit
  router.get("/journal", async (req: Request, res: Response) => {
    try {
      const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
      const cursorRaw = Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor;

      const limitParsed = typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : 200;
      const limit = Number.isFinite(limitParsed) ? Math.max(1, Math.min(1000, limitParsed)) : 200;
      const cursor = typeof cursorRaw === "string" && cursorRaw.trim() !== "" ? cursorRaw.trim() : undefined;

      const data = await readUnitJournal({ unit: HYPANEL_SYSTEMD_UNIT, limit, cursor });
      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Failed to read system journal",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /api/system/version - Get current installed version
  router.get("/version", (req: Request, res: Response) => {
    try {
      const currentVersion = getCurrentVersion();
      res.json({ version: currentVersion });
    } catch (error) {
      res.status(500).json({
        error: "Failed to get version",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /api/system/version/check - Check for updates against GitHub releases
  router.get("/version/check", async (req: Request, res: Response) => {
    try {
      const currentVersion = getCurrentVersion();
      const now = Date.now();
      const forceRefresh = req.query.force === "true" || req.query.force === "1";

      // Check cache first (unless force refresh is requested)
      if (!forceRefresh && updateCheckCache && now < updateCheckCache.expiresAt) {
        // Return cached data, but update currentVersion in case it changed
        const cachedData = { ...updateCheckCache.data, currentVersion };
        return res.json(cachedData);
      }

      // Fetch latest release from GitHub API based on configured channel
      const { url: githubApiUrl, channel } = getGitHubReleaseUrl();
      
      // Build headers with optional GitHub token
      const headers: Record<string, string> = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "hypanel",
      };

      // Add GitHub token if available (increases rate limit from 60/hour to 5,000/hour)
      const githubToken = process.env.GITHUB_TOKEN;
      if (githubToken) {
        headers["Authorization"] = `Bearer ${githubToken}`;
      }

      let latestRelease: GitHubRelease;
      let rateLimitRemaining: number | undefined;
      let rateLimitReset: number | undefined;

      try {
        const response = await fetch(githubApiUrl, { headers });

        // Parse rate limit headers
        const rateLimitRemainingHeader = response.headers.get("X-RateLimit-Remaining");
        const rateLimitResetHeader = response.headers.get("X-RateLimit-Reset");
        
        if (rateLimitRemainingHeader) {
          rateLimitRemaining = parseInt(rateLimitRemainingHeader, 10);
        }
        if (rateLimitResetHeader) {
          rateLimitReset = parseInt(rateLimitResetHeader, 10) * 1000; // Convert to milliseconds
        }

        if (!response.ok) {
          if (response.status === 403) {
            // Rate limit exceeded
            const errorMessage = rateLimitReset
              ? `Rate limit exceeded. Resets at ${new Date(rateLimitReset).toLocaleString()}`
              : "Rate limit exceeded. Please try again later.";
            
            // Cache the error response for a shorter duration (15 minutes)
            updateCheckCache = {
              data: {
                currentVersion,
                latestVersion: currentVersion,
                updateAvailable: false,
                error: errorMessage,
                rateLimitRemaining,
                rateLimitReset,
              },
              timestamp: now,
              expiresAt: now + (15 * 60 * 1000), // 15 minutes
            };

            return res.status(429).json(updateCheckCache.data);
          }

          if (response.status === 404) {
            // No releases found
            const errorMessage = channel === "staging"
              ? `No staging release found. Please ensure a release with tag 'staging' exists.`
              : "No releases found";
            const errorData = {
              currentVersion,
              latestVersion: currentVersion,
              updateAvailable: false,
              error: errorMessage,
            };

            // Cache 404 for 1 hour
            updateCheckCache = {
              data: errorData,
              timestamp: now,
              expiresAt: now + CACHE_DURATION_MS,
            };

            return res.json(errorData);
          }

          throw new Error(`GitHub API returned ${response.status}`);
        }

        latestRelease = await response.json() as GitHubRelease;
      } catch (error) {
        // Network error or API failure
        console.error(`Failed to fetch ${channel} release from GitHub:`, error);
        
        const errorData = {
          currentVersion,
          latestVersion: currentVersion,
          updateAvailable: false,
          error: `Failed to check for ${channel} updates. Please try again later.`,
          rateLimitRemaining,
          rateLimitReset,
        };

        // Cache error for shorter duration (15 minutes)
        updateCheckCache = {
          data: errorData,
          timestamp: now,
          expiresAt: now + (15 * 60 * 1000),
        };

        return res.status(503).json(errorData);
      }

      // Extract version from tag (remove 'v' prefix if present)
      const latestVersion = latestRelease.tag_name?.replace(/^v/, "") || latestRelease.tag_name || "";
      const releaseUrl = latestRelease.html_url || `https://github.com/OnyxWm/hypanel/releases/tag/${latestRelease.tag_name}`;
      const releaseNotes = latestRelease.body || "";

      // Compare versions
      const comparison = compareVersions(currentVersion, latestVersion);
      const updateAvailable = comparison < 0; // Current version is less than latest

      const responseData = {
        currentVersion,
        latestVersion,
        updateAvailable,
        releaseUrl,
        releaseNotes: releaseNotes.substring(0, 500), // Limit release notes length
        rateLimitRemaining,
        rateLimitReset,
      };

      // Cache successful response for 1 hour
      updateCheckCache = {
        data: responseData,
        timestamp: now,
        expiresAt: now + CACHE_DURATION_MS,
      };

      res.json(responseData);
    } catch (error) {
      console.error("Error checking for updates:", error);
      res.status(500).json({
        currentVersion: getCurrentVersion(),
        latestVersion: getCurrentVersion(),
        updateAvailable: false,
        error: "Failed to check for updates",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /api/system/version/update - Update the application to the latest version
  router.post("/version/update", async (req: Request, res: Response) => {
    try {
      const currentVersion = getCurrentVersion();
      const HYPANEL_INSTALL_DIR = "/opt/hypanel";
      const tempDownload = "/tmp/hypanel-update.tar.gz";
      const tempExtract = "/tmp/hypanel-update-extract";
      const password = (req.body as { password?: string })?.password;

      // Helper function to run sudo commands with optional password
      const runSudo = async (command: string): Promise<string> => {
        if (password) {
          // Use sudo -S to read password from stdin
          // Create a temporary script to safely pass the password
          const tempScript = `/tmp/hypanel-sudo-${Date.now()}.sh`;
          try {
            // Write password to script (more secure than command line)
            fs.writeFileSync(tempScript, `#!/bin/bash\necho '${password.replace(/'/g, "'\\''")}' | sudo -S ${command}\n`);
            fs.chmodSync(tempScript, 0o700);
            
            const result = await execAsync(`bash "${tempScript}" 2>&1`, {
              maxBuffer: 10 * 1024 * 1024,
            });
            
            // Check for password errors in combined output
            const output = `${result.stdout} ${result.stderr}`;
            if (output.includes("incorrect password") || output.includes("sorry") || 
                output.includes("authentication failure")) {
              throw new Error("Incorrect password");
            }
            
            // Clean up script immediately
            try {
              fs.unlinkSync(tempScript);
            } catch {
              // Ignore cleanup errors
            }
            
            return result.stdout;
          } catch (error) {
            // Clean up script on error
            try {
              fs.unlinkSync(tempScript);
            } catch {
              // Ignore cleanup errors
            }
            
            // Check if it's a password error
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorOutput = (error as any)?.stdout || (error as any)?.stderr || "";
            const fullError = `${errorMsg} ${errorOutput}`;
            
            if (fullError.includes("incorrect password") || fullError.includes("sorry") || 
                fullError.includes("authentication failure")) {
              throw new Error("Incorrect password");
            }
            throw error;
          }
        } else {
          // Try without password (NOPASSWD should work)
          try {
            const result = await execAsync(`sudo ${command} 2>&1`, {
              maxBuffer: 10 * 1024 * 1024,
            });
            // Check if sudo is asking for password in combined output
            const output = `${result.stdout} ${result.stderr}`;
            if (output.includes("password") || output.includes("a password is required") || 
                output.includes("command not allowed") || output.includes("unable to open /run/sudo")) {
              throw new Error("Password required");
            }
            return result.stdout;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            // execAsync errors have stdout and stderr properties
            const errorStdout = (error as any)?.stdout || "";
            const errorStderr = (error as any)?.stderr || "";
            const fullError = `${errorMsg} ${errorStdout} ${errorStderr}`;
            
            // Check for various password requirement indicators
            if (fullError.includes("password") || fullError.includes("a password is required") || 
                fullError.includes("command not allowed") || fullError.includes("unable to open /run/sudo") ||
                fullError.includes("terminal is required") || fullError.includes("command not allowed")) {
              throw new Error("Password required");
            }
            throw error;
          }
        }
      };

      // Step 1: Verify an update is available
      const { url: githubApiUrl, channel } = getGitHubReleaseUrl();
      console.log(`Checking for available ${channel} updates...`);
      
      const headers: Record<string, string> = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "hypanel",
      };

      const githubToken = process.env.GITHUB_TOKEN;
      if (githubToken) {
        headers["Authorization"] = `Bearer ${githubToken}`;
      }

      let latestRelease: GitHubRelease;
      try {
        const response = await fetch(githubApiUrl, { headers });
        if (!response.ok) {
          const errorMessage = response.status === 404 && channel === "staging"
            ? `Staging release not found. Please ensure a release with tag 'staging' exists.`
            : `Failed to fetch ${channel} release info: ${response.status}`;
          return res.status(500).json({
            success: false,
            error: errorMessage,
            message: `Could not check for ${channel} updates`,
          });
        }
        latestRelease = await response.json() as GitHubRelease;
      } catch (error) {
        console.error(`Failed to fetch ${channel} release:`, error);
        return res.status(500).json({
          success: false,
          error: `Failed to fetch ${channel} release from GitHub`,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      const latestVersion = latestRelease.tag_name?.replace(/^v/, "") || latestRelease.tag_name || "";
      const comparison = compareVersions(currentVersion, latestVersion);
      
      if (comparison >= 0) {
        return res.status(400).json({
          success: false,
          error: "No update available",
          message: `Already running latest ${channel} version: ${currentVersion}`,
        });
      }

      console.log(`${channel.charAt(0).toUpperCase() + channel.slice(1)} update available: ${currentVersion} -> ${latestVersion}`);

      // Step 2: Stop all servers
      console.log("Stopping all servers...");
      try {
        const servers = serverManager.getAllServers();
        const serversToStop = servers.filter((s) => s.status !== "offline").map((s) => s.id);
        
        if (serversToStop.length > 0) {
          await Promise.allSettled(
            serversToStop.map(async (id) => {
              try {
                await serverManager.stopServer(id, true); // Force stop
              } catch (err) {
                console.warn(`Failed to stop server ${id}:`, err);
              }
            })
          );
          // Wait a bit for servers to fully stop
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error("Error stopping servers:", error);
        return res.status(500).json({
          success: false,
          error: "Failed to stop all servers",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      // Step 3: Download the release tarball
      console.log("Downloading update package...");
      const downloadUrl = latestRelease.assets?.find((asset: any) => 
        asset.name?.endsWith(".tar.gz")
      )?.browser_download_url;

      if (!downloadUrl) {
        return res.status(500).json({
          success: false,
          error: "No .tar.gz asset found in release",
          message: "Release does not contain a downloadable package",
        });
      }

      try {
        const downloadResponse = await fetch(downloadUrl, { headers });
        if (!downloadResponse.ok) {
          return res.status(500).json({
            success: false,
            error: `Failed to download update: ${downloadResponse.status}`,
            message: "Could not download update package",
          });
        }

        const arrayBuffer = await downloadResponse.arrayBuffer();
        fs.writeFileSync(tempDownload, Buffer.from(arrayBuffer));
        console.log(`Downloaded ${arrayBuffer.byteLength} bytes`);
      } catch (error) {
        console.error("Download failed:", error);
        return res.status(500).json({
          success: false,
          error: "Failed to download update package",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      // Step 4: Extract to temporary location
      console.log("Extracting update package...");
      try {
        // Clean up any existing extract directory
        if (fs.existsSync(tempExtract)) {
          fs.rmSync(tempExtract, { recursive: true, force: true });
        }
        fs.mkdirSync(tempExtract, { recursive: true });

        // Extract using tar command
        await execAsync(`tar -xzf "${tempDownload}" -C "${tempExtract}"`);
        console.log("Extraction complete");
      } catch (error) {
        console.error("Extraction failed:", error);
        // Clean up
        if (fs.existsSync(tempDownload)) fs.unlinkSync(tempDownload);
        if (fs.existsSync(tempExtract)) fs.rmSync(tempExtract, { recursive: true, force: true });
        return res.status(500).json({
          success: false,
          error: "Failed to extract update package",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      // Step 5: Verify extracted files
      const extractedBackendDist = path.join(tempExtract, "apps", "backend", "dist");
      const extractedWebpanelDist = path.join(tempExtract, "apps", "webpanel", "dist");
      
      if (!fs.existsSync(extractedBackendDist) || !fs.existsSync(extractedWebpanelDist)) {
        console.error("Extracted package missing required directories");
        if (fs.existsSync(tempDownload)) fs.unlinkSync(tempDownload);
        if (fs.existsSync(tempExtract)) fs.rmSync(tempExtract, { recursive: true, force: true });
        return res.status(500).json({
          success: false,
          error: "Invalid update package structure",
          message: "Extracted package does not contain required directories",
        });
      }

      // Step 6: Install to /opt/hypanel
      console.log("Installing update to /opt/hypanel...");
      try {
        // Check if install directory exists
        if (!fs.existsSync(HYPANEL_INSTALL_DIR)) {
          return res.status(500).json({
            success: false,
            error: "Installation directory not found",
            message: `${HYPANEL_INSTALL_DIR} does not exist. This endpoint is only for production installations.`,
          });
        }

        // Check if filesystem is writable first (using sudo since we'll be writing with sudo)
        let filesystemWritable = false;
        try {
          const testFile = path.join(HYPANEL_INSTALL_DIR, ".hypanel-update-test");
          // Test with sudo to match actual write operations - use touch instead of sh -c for security
          await runSudo(`touch "${testFile}"`);
          await runSudo(`rm -f "${testFile}"`);
          filesystemWritable = true;
        } catch (testError) {
          const testErrorMsg = testError instanceof Error ? testError.message : String(testError);
          const testErrorStdout = (testError as any)?.stdout || "";
          const testErrorStderr = (testError as any)?.stderr || "";
          const testFullError = `${testErrorMsg} ${testErrorStdout} ${testErrorStderr}`;
          
          console.log("Filesystem test error - checking for password requirement");
          console.log("  Error message:", testErrorMsg);
          console.log("  Error stdout:", testErrorStdout.substring(0, 200));
          console.log("  Error stderr:", testErrorStderr.substring(0, 200));
          console.log("  Full error:", testFullError.substring(0, 500));
          
          // Check if it's a password requirement - check both the thrown error message and the original error output
          const isPasswordError = testErrorMsg.includes("Password required") ||
                                  testFullError.includes("password") || 
                                  testFullError.includes("Password required") || 
                                  testFullError.includes("a password is required") || 
                                  testFullError.includes("command not allowed") ||
                                  testFullError.includes("unable to open /run/sudo") || 
                                  testFullError.includes("terminal is required") ||
                                  testFullError.toLowerCase().includes("permission denied");
          
          if (isPasswordError) {
            console.log("Password requirement detected! Returning 401 with requiresPassword: true");
            if (!password) {
              return res.status(401).json({
                success: false,
                error: "Password required",
                message: "Sudo password is required to write to /opt/hypanel. Please provide your password.",
                requiresPassword: true,
              });
            } else if (testFullError.includes("Incorrect password") || testFullError.includes("incorrect") || 
                       testFullError.includes("sorry") || testFullError.includes("authentication failure")) {
              return res.status(401).json({
                success: false,
                error: "Incorrect password",
                message: "The provided password is incorrect. Please try again.",
                requiresPassword: true,
              });
            } else {
              // Password provided but still getting password error - might be wrong password
              return res.status(401).json({
                success: false,
                error: "Password required",
                message: "Sudo password is required. Please provide your password.",
                requiresPassword: true,
              });
            }
          }
          
          console.warn("Filesystem appears read-only, attempting to remount as read-write...");
          // Try to remount the filesystem as read-write
          try {
            // Find the mount point - check /opt/hypanel, /opt, or root
            let mountPoint = null;
            try {
              const mountCheck = await execAsync(`mount | grep " ${HYPANEL_INSTALL_DIR} " || mount | grep " /opt " || mount | grep " / " | head -1`);
              const mountLine = mountCheck.stdout.trim();
              if (mountLine.includes(` ${HYPANEL_INSTALL_DIR} `)) {
                mountPoint = HYPANEL_INSTALL_DIR;
              } else if (mountLine.includes(' /opt ')) {
                mountPoint = '/opt';
              } else {
                mountPoint = '/';
              }
            } catch {
              // If we can't find the mount, try common mount points
              mountPoint = '/opt';
            }
            
            if (mountPoint) {
              // Try to remount as read-write
              await runSudo(`mount -o remount,rw "${mountPoint}" 2>&1`);
              
              // Test again with sudo
              const retestFile = path.join(HYPANEL_INSTALL_DIR, ".hypanel-update-test");
              await runSudo(`touch "${retestFile}"`);
              await runSudo(`rm -f "${retestFile}"`);
              filesystemWritable = true;
              console.log(`Filesystem at ${mountPoint} remounted as read-write successfully`);
            }
          } catch (remountError) {
            console.error("Failed to remount filesystem:", remountError);
            const remountErrorMsg = remountError instanceof Error ? remountError.message : String(remountError);
            const remountErrorStdout = (remountError as any)?.stdout || "";
            const remountErrorStderr = (remountError as any)?.stderr || "";
            const remountFullError = `${remountErrorMsg} ${remountErrorStdout} ${remountErrorStderr}`;
            
            // Check if it's a password requirement
            if (remountFullError.includes("password") || remountFullError.includes("Password required") || 
                remountFullError.includes("a password is required") || remountFullError.includes("command not allowed") ||
                remountFullError.includes("unable to open /run/sudo") || remountFullError.includes("terminal is required") ||
                remountFullError.toLowerCase().includes("permission denied")) {
              if (!password) {
                return res.status(401).json({
                  success: false,
                  error: "Password required",
                  message: "Sudo password is required to remount the filesystem as read-write. Please provide your password.",
                  requiresPassword: true,
                });
              } else {
                return res.status(401).json({
                  success: false,
                  error: "Incorrect password",
                  message: "The provided password is incorrect. Please try again.",
                  requiresPassword: true,
                });
              }
            }
          }
        }

        if (!filesystemWritable) {
          return res.status(500).json({
            success: false,
            error: "Filesystem is read-only",
            message: `Cannot write to ${HYPANEL_INSTALL_DIR}. The filesystem is mounted read-only and could not be remounted. Please manually remount as read-write: sudo mount -o remount,rw /opt (or the appropriate mount point)`,
          });
        }

        // Use rsync to copy files, preserving data directories
        // Exclude data directories and node_modules to preserve existing data
        // Use sudo since /opt/hypanel is root-owned
        // Use --no-owner --no-group to avoid ownership preservation issues
        // Use --inplace to avoid creating temporary files (helps with some read-only scenarios)
        try {
          await runSudo(
            `rsync -a --no-owner --no-group --inplace --exclude='data' --exclude='node_modules' "${tempExtract}/" "${HYPANEL_INSTALL_DIR}/" 2>&1`
          );
        } catch (rsyncError) {
          const rsyncErrorMsg = rsyncError instanceof Error ? rsyncError.message : String(rsyncError);
          // Check if it's a password error
          if (rsyncErrorMsg.includes("password") || rsyncErrorMsg.includes("Password required") || rsyncErrorMsg.includes("Incorrect password")) {
            if (!password) {
              return res.status(401).json({
                success: false,
                error: "Password required",
                message: "Sudo password is required to install the update. Please provide your password.",
                requiresPassword: true,
              });
            } else {
              return res.status(401).json({
                success: false,
                error: "Incorrect password",
                message: "The provided password is incorrect. Please try again.",
                requiresPassword: true,
              });
            }
          }
          
          // If rsync fails, try cp as fallback
          console.warn("rsync failed, trying cp fallback:", rsyncError);
          try {
            await runSudo(
              `cp -r "${tempExtract}"/* "${HYPANEL_INSTALL_DIR}/" 2>&1`
            );
          } catch (cpError) {
            console.error("Both rsync and cp failed:", cpError);
            const errorMsg = cpError instanceof Error ? cpError.message : String(cpError);
            // Check if it's a password error
            if (errorMsg.includes("password") || errorMsg.includes("Password required") || errorMsg.includes("Incorrect password")) {
              if (!password) {
                return res.status(401).json({
                  success: false,
                  error: "Password required",
                  message: "Sudo password is required to install the update. Please provide your password.",
                  requiresPassword: true,
                });
              } else {
                return res.status(401).json({
                  success: false,
                  error: "Incorrect password",
                  message: "The provided password is incorrect. Please try again.",
                  requiresPassword: true,
                });
              }
            }
            throw new Error(`Failed to copy files: ${errorMsg}`);
          }
        }

        // Ensure proper permissions (use sudo for root-owned directory)
        try {
          await runSudo(`chmod -R 644 "${HYPANEL_INSTALL_DIR}"/* 2>/dev/null || true`);
          await runSudo(`find "${HYPANEL_INSTALL_DIR}" -type d -exec chmod 755 {} \\; 2>/dev/null || true`);
          await runSudo(`chmod +x "${HYPANEL_INSTALL_DIR}/apps/backend/dist/index.js" 2>/dev/null || true`);
        } catch (permError) {
          console.warn("Warning: Failed to set some permissions:", permError);
          // Continue anyway
        }

        console.log("Installation complete");
      } catch (error) {
        console.error("Installation failed:", error);
        if (fs.existsSync(tempDownload)) fs.unlinkSync(tempDownload);
        if (fs.existsSync(tempExtract)) fs.rmSync(tempExtract, { recursive: true, force: true });
        return res.status(500).json({
          success: false,
          error: "Failed to install update",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      // Step 7: Rebuild native modules
      console.log("Rebuilding native modules...");
      try {
        const backendDir = path.join(HYPANEL_INSTALL_DIR, "apps", "backend");
        const nodePath = process.execPath; // Use the Node.js that's running this process
        
        // Find npm
        let npmPath = "npm";
        try {
          const npmCheck = await execAsync("which npm");
          npmPath = npmCheck.stdout.trim() || "npm";
        } catch {
          // Fallback to npm in PATH
        }

        // Install/rebuild production dependencies (npm doesn't need sudo, runs as hypanel user)
        await execAsync(`cd "${backendDir}" && "${npmPath}" install --omit=dev`, {
          env: { ...process.env, PATH: process.env.PATH },
        });

        // Rebuild better-sqlite3
        await execAsync(`cd "${backendDir}" && "${npmPath}" rebuild better-sqlite3 || "${npmPath}" install better-sqlite3 --build-from-source --force --omit=dev`, {
          env: { ...process.env, PATH: process.env.PATH },
        });

        console.log("Native modules rebuilt");
      } catch (error) {
        console.warn("Warning: Failed to rebuild native modules:", error);
        // Continue anyway - the app might still work
      }

      // Step 8: Clean up temp files
      try {
        if (fs.existsSync(tempDownload)) fs.unlinkSync(tempDownload);
        if (fs.existsSync(tempExtract)) fs.rmSync(tempExtract, { recursive: true, force: true });
      } catch (error) {
        console.warn("Warning: Failed to clean up temp files:", error);
      }

      // Step 9: Restart systemd service
      console.log("Restarting systemd service...");
      // Return response first, then restart (similar to daemon/restart endpoint)
      res.status(202).json({
        success: true,
        message: `Update installed successfully. Service will restart shortly.`,
        version: latestVersion,
      });

      // Queue restart after a short delay
      queueRestartUnit({ unit: HYPANEL_SYSTEMD_UNIT, delayMs: 1000 });
      
    } catch (error) {
      console.error("Update process failed:", error);
      res.status(500).json({
        success: false,
        error: "Update failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
