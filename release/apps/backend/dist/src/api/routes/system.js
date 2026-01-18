import { Router } from "express";
import pidusage from "pidusage";
import os from "os";
import { HYPANEL_SYSTEMD_UNIT, queueRestartUnit, readUnitJournal } from "../../systemd/systemd.js";
export function createSystemRoutes(serverManager) {
    const router = Router();
    // GET /api/system/stats - Get aggregated system resource stats from all running servers
    router.get("/stats", async (req, res) => {
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
            const serverPids = [];
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
                }
                catch (error) {
                    // If pidusage fails for all PIDs at once, try individually
                    for (const pid of serverPids) {
                        try {
                            const stat = await pidusage(pid);
                            totalCpu += stat.cpu || 0;
                            totalMemoryBytes += stat.memory || 0;
                        }
                        catch (err) {
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
        }
        catch (error) {
            console.error("Failed to get system stats:", error);
            res.status(500).json({ error: "Failed to get system stats" });
        }
    });
    const summarize = (requested, results) => {
        const succeeded = results.filter((r) => r.ok).map((r) => r.id);
        const failed = results
            .filter((r) => !r.ok)
            .map((r) => ({ id: r.id, error: r.error || "Unknown error" }));
        return { requested, succeeded, failed };
    };
    // POST /api/system/servers/stop-all - Stop all servers (any non-offline status)
    router.post("/servers/stop-all", async (req, res) => {
        const force = req.query.force === "true";
        const servers = serverManager.getAllServers();
        const requested = servers.filter((s) => s.status !== "offline").map((s) => s.id);
        const settled = await Promise.allSettled(requested.map(async (id) => {
            await serverManager.stopServer(id, force);
            return id;
        }));
        const results = settled.map((r, idx) => {
            const id = requested[idx];
            if (r.status === "fulfilled")
                return { id, ok: true };
            const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
            return { id, ok: false, error: msg };
        });
        res.json(summarize(requested, results));
    });
    // POST /api/system/servers/restart-online - Restart only servers currently online
    router.post("/servers/restart-online", async (req, res) => {
        const servers = serverManager.getAllServers();
        const requested = servers.filter((s) => s.status === "online").map((s) => s.id);
        const settled = await Promise.allSettled(requested.map(async (id) => {
            await serverManager.restartServer(id);
            return id;
        }));
        const results = settled.map((r, idx) => {
            const id = requested[idx];
            if (r.status === "fulfilled")
                return { id, ok: true };
            const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
            return { id, ok: false, error: msg };
        });
        res.json(summarize(requested, results));
    });
    // POST /api/system/daemon/restart - Queue systemd restart of the hypanel service
    router.post("/daemon/restart", (req, res) => {
        // Return first, then restart shortly after to avoid killing the in-flight HTTP response.
        res.status(202).json({ queued: true, service: HYPANEL_SYSTEMD_UNIT });
        queueRestartUnit({ unit: HYPANEL_SYSTEMD_UNIT, delayMs: 250 });
    });
    // GET /api/system/journal - Read systemd journal entries for hypanel unit
    router.get("/journal", async (req, res) => {
        try {
            const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
            const cursorRaw = Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor;
            const limitParsed = typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : 200;
            const limit = Number.isFinite(limitParsed) ? Math.max(1, Math.min(1000, limitParsed)) : 200;
            const cursor = typeof cursorRaw === "string" && cursorRaw.trim() !== "" ? cursorRaw.trim() : undefined;
            const data = await readUnitJournal({ unit: HYPANEL_SYSTEMD_UNIT, limit, cursor });
            res.json(data);
        }
        catch (error) {
            res.status(500).json({
                error: "Failed to read system journal",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    });
    return router;
}
//# sourceMappingURL=system.js.map