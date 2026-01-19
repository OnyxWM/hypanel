import { Router, Request, Response } from "express";
import pidusage from "pidusage";
import os from "os";
import { ServerManager } from "../../server/ServerManager.js";
import { HYPANEL_SYSTEMD_UNIT, queueRestartUnit, readUnitJournal } from "../../systemd/systemd.js";
import { getCurrentVersion, compareVersions } from "../../utils/version.js";

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  body: string | null;
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

      // Check cache first
      if (updateCheckCache && now < updateCheckCache.expiresAt) {
        // Return cached data, but update currentVersion in case it changed
        const cachedData = { ...updateCheckCache.data, currentVersion };
        return res.json(cachedData);
      }

      // Fetch latest release from GitHub API
      const githubApiUrl = "https://api.github.com/repos/OnyxWm/hypanel/releases/latest";
      
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
            const errorData = {
              currentVersion,
              latestVersion: currentVersion,
              updateAvailable: false,
              error: "No releases found",
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
        console.error("Failed to fetch latest release from GitHub:", error);
        
        const errorData = {
          currentVersion,
          latestVersion: currentVersion,
          updateAvailable: false,
          error: "Failed to check for updates. Please try again later.",
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

  return router;
}
