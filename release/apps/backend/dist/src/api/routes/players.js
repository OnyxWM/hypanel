import { Router } from "express";
import { z } from "zod";
import { getPlayerTracker } from "../../server/PlayerTracker.js";
import { getServer } from "../../database/db.js";
import { validateParams } from "../middleware/validation.js";
import { HypanelError } from "../../errors/index.js";
const serverIdSchema = z.object({
    id: z.string().min(1),
});
export function createPlayerRoutes(serverManager) {
    const router = Router();
    const playerTracker = getPlayerTracker();
    // GET /api/players - Get all players across all servers
    router.get("/", (req, res) => {
        try {
            const allPlayers = playerTracker.getPlayers();
            const servers = serverManager.getAllServers();
            // Create a map of server IDs to server names
            const serverMap = new Map();
            for (const server of servers) {
                serverMap.set(server.id, server.name);
            }
            // Enrich player data with server names
            const enrichedPlayers = allPlayers.map((player) => ({
                playerName: player.playerName,
                serverId: player.serverId,
                serverName: serverMap.get(player.serverId) || "Unknown Server",
                joinTime: player.joinTime.toISOString(),
                lastSeen: player.lastSeen.toISOString(),
            }));
            // Return empty array if no players (not an error)
            res.json(enrichedPlayers || []);
        }
        catch (error) {
            console.error("Error in /api/players:", error);
            if (error instanceof HypanelError) {
                return res.status(error.statusCode).json(error.toJSON());
            }
            res.status(500).json({
                code: "INTERNAL_ERROR",
                message: "Failed to get players",
                details: error instanceof Error ? error.message : String(error),
                suggestedAction: "Check server logs for details",
            });
        }
    });
    // GET /api/players/servers/:id - Get players for a specific server
    router.get("/servers/:id", validateParams(serverIdSchema), (req, res) => {
        try {
            const { id } = req.params;
            // Verify server exists
            const dbServer = getServer(id);
            if (!dbServer) {
                return res.status(404).json({
                    code: "SERVER_NOT_FOUND",
                    message: `Server ${id} not found`,
                    suggestedAction: "Verify the server ID is correct",
                });
            }
            const players = playerTracker.getPlayers(id);
            // Enrich with server name
            const enrichedPlayers = players.map((player) => ({
                playerName: player.playerName,
                serverId: player.serverId,
                serverName: dbServer.name,
                joinTime: player.joinTime.toISOString(),
                lastSeen: player.lastSeen.toISOString(),
            }));
            res.json(enrichedPlayers);
        }
        catch (error) {
            if (error instanceof HypanelError) {
                return res.status(error.statusCode).json(error.toJSON());
            }
            res.status(500).json({
                code: "INTERNAL_ERROR",
                message: "Failed to get server players",
                suggestedAction: "Check server logs for details",
            });
        }
    });
    return router;
}
//# sourceMappingURL=players.js.map