import { EventEmitter } from "events";
import { PlayerInfo } from "../types/index.js";
/**
 * PlayerTracker manages in-memory player tracking across all servers.
 * Tracks players by server ID and player name, maintaining join times and last seen timestamps.
 */
export declare class PlayerTracker extends EventEmitter {
    private players;
    /**
     * Add or update a player on a server
     */
    addPlayer(serverId: string, playerName: string): void;
    /**
     * Remove a player from a server
     */
    removePlayer(serverId: string, playerName: string): void;
    /**
     * Get all players for a specific server, or all players if serverId is not provided
     */
    getPlayers(serverId?: string): PlayerInfo[];
    /**
     * Get player names for a specific server
     */
    getPlayerNames(serverId: string): string[];
    /**
     * Clear all players for a server (e.g., when server stops)
     */
    clearServerPlayers(serverId: string): void;
    /**
     * Update players from a server command response (e.g., /who command)
     * This will add new players and remove players that are no longer in the list
     */
    updatePlayersFromList(serverId: string, playerNames: string[]): void;
    /**
     * Strip ANSI escape codes from a string
     */
    private stripAnsiCodes;
    /**
     * Check if a string is a valid player name
     * Filters out common non-player strings and validates format
     */
    private isValidPlayerName;
    /**
     * Parse /who command output to extract player names
     * Handles various formats:
     * - "There are X of a max of Y players online: Player1, Player2, Player3"
     * - "Players online: Player1, Player2"
     * - "Player1, Player2, Player3"
     * - Hytale-specific formats
     */
    parseListCommand(output: string): string[];
    /**
     * Get count of players for a server
     */
    getPlayerCount(serverId: string): number;
    /**
     * Get total count of players across all servers
     */
    getTotalPlayerCount(): number;
}
export declare function getPlayerTracker(): PlayerTracker;
//# sourceMappingURL=PlayerTracker.d.ts.map