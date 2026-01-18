import { EventEmitter } from "events";
import { PlayerInfo } from "../types/index.js";

/**
 * PlayerTracker manages in-memory player tracking across all servers.
 * Tracks players by server ID and player name, maintaining join times and last seen timestamps.
 */
export class PlayerTracker extends EventEmitter {
  // Map<serverId, Map<playerName, PlayerInfo>>
  private players: Map<string, Map<string, PlayerInfo>> = new Map();

  /**
   * Add or update a player on a server
   */
  addPlayer(serverId: string, playerName: string): void {
    if (!serverId || !playerName) {
      return;
    }

    const now = new Date();
    let serverPlayers = this.players.get(serverId);
    
    if (!serverPlayers) {
      serverPlayers = new Map();
      this.players.set(serverId, serverPlayers);
    }

    const existingPlayer = serverPlayers.get(playerName);
    const isNewPlayer = !existingPlayer;

    // Update or create player info
    serverPlayers.set(playerName, {
      playerName,
      serverId,
      joinTime: existingPlayer?.joinTime || now,
      lastSeen: now,
    });

    // Emit event only for new players
    if (isNewPlayer) {
      this.emit("player:join", {
        serverId,
        playerName,
        joinTime: now,
      });
    }
  }

  /**
   * Remove a player from a server
   */
  removePlayer(serverId: string, playerName: string): void {
    if (!serverId || !playerName) {
      return;
    }

    const serverPlayers = this.players.get(serverId);
    if (!serverPlayers) {
      return;
    }

    const wasRemoved = serverPlayers.delete(playerName);
    
    if (wasRemoved) {
      // Clean up empty server maps
      if (serverPlayers.size === 0) {
        this.players.delete(serverId);
      }

      this.emit("player:leave", {
        serverId,
        playerName,
      });
    }
  }

  /**
   * Get all players for a specific server, or all players if serverId is not provided
   */
  getPlayers(serverId?: string): PlayerInfo[] {
    if (serverId) {
      const serverPlayers = this.players.get(serverId);
      if (!serverPlayers) {
        return [];
      }
      return Array.from(serverPlayers.values());
    }

    // Return all players from all servers
    const allPlayers: PlayerInfo[] = [];
    for (const serverPlayers of this.players.values()) {
      allPlayers.push(...Array.from(serverPlayers.values()));
    }
    return allPlayers;
  }

  /**
   * Get player names for a specific server
   */
  getPlayerNames(serverId: string): string[] {
    const serverPlayers = this.players.get(serverId);
    if (!serverPlayers) {
      return [];
    }
    return Array.from(serverPlayers.keys());
  }

  /**
   * Clear all players for a server (e.g., when server stops)
   */
  clearServerPlayers(serverId: string): void {
    const serverPlayers = this.players.get(serverId);
    if (!serverPlayers) {
      return;
    }

    // Emit leave events for all players
    for (const playerName of serverPlayers.keys()) {
      this.emit("player:leave", {
        serverId,
        playerName,
      });
    }

    this.players.delete(serverId);
  }

  /**
   * Update players from a server command response (e.g., /who command)
   * This will add new players and remove players that are no longer in the list
   */
  updatePlayersFromList(serverId: string, playerNames: string[]): void {
    if (!serverId) {
      return;
    }

    const serverPlayers = this.players.get(serverId) || new Map();
    const currentPlayerNames = new Set(playerNames);
    const trackedPlayerNames = new Set(serverPlayers.keys());

    // Add new players
    for (const playerName of currentPlayerNames) {
      if (!trackedPlayerNames.has(playerName)) {
        this.addPlayer(serverId, playerName);
      } else {
        // Update last seen for existing players
        const player = serverPlayers.get(playerName);
        if (player) {
          player.lastSeen = new Date();
        }
      }
    }

    // Remove players that are no longer in the list
    for (const playerName of trackedPlayerNames) {
      if (!currentPlayerNames.has(playerName)) {
        this.removePlayer(serverId, playerName);
      }
    }
  }

  /**
   * Strip ANSI escape codes from a string
   */
  private stripAnsiCodes(str: string): string {
    // Remove ANSI escape codes: \x1b[...m or \u001b[...m
    return str.replace(/\u001b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*m/g, '');
  }

  /**
   * Check if a string is a valid player name
   * Filters out common non-player strings and validates format
   */
  private isValidPlayerName(name: string): boolean {
    if (!name || name.length === 0 || name.length > 32) {
      return false;
    }

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      return false;
    }

    const lowerName = trimmedName.toLowerCase();
    
    // Filter out common non-player strings (exact matches or contains whole words)
    const invalidExactMatches = [
      'empty',
      '(empty)',
      'empty)',
      '(empty',
      'quicconnectionaddress',
      'transitioning to setup',
      'transitioning',
      'none',
      'null',
      'undefined',
      'unknown',
    ];

    // Check exact matches first
    if (invalidExactMatches.includes(lowerName)) {
      return false;
    }

    // Check for invalid words/phrases (more specific checks)
    const invalidWords = [
      'connectionaddress',
      'connection',
      'address',
      'localhost',
      '127.0.0.1',
      'setup',
      'transitioning',
    ];

    // Check if name contains any invalid word as a whole word or part of connection-related terms
    if (invalidWords.some(word => lowerName.includes(word))) {
      // But allow if it's part of a legitimate name (e.g., "ConnectionMaster" - but this is unlikely)
      // For safety, reject anything with these connection-related terms
      return false;
    }

    // Player names should be alphanumeric with spaces, hyphens, underscores only
    // Should not contain parentheses, brackets, or other special characters (unless part of display name handling)
    // But we allow spaces, hyphens, and underscores
    if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmedName)) {
      return false;
    }

    // Should not be all numbers or all special characters
    if (/^[\d\s\-_]+$/.test(trimmedName)) {
      return false;
    }

    // Should contain at least one letter
    if (!/[a-zA-Z]/.test(trimmedName)) {
      return false;
    }

    // Filter out names that look like IP addresses
    if (/^\d+\.\d+\.\d+\.\d+/.test(trimmedName)) {
      return false;
    }

    return true;
  }

  /**
   * Parse /who command output to extract player names
   * Handles various formats:
   * - "There are X of a max of Y players online: Player1, Player2, Player3"
   * - "Players online: Player1, Player2"
   * - "Player1, Player2, Player3"
   * - Hytale-specific formats
   */
  parseListCommand(output: string): string[] {
    if (!output) {
      return [];
    }

    // Strip ANSI codes from the entire output first
    const cleanOutput = this.stripAnsiCodes(output);
    const lines = cleanOutput.split("\n").map(line => line.trim()).filter(line => line.length > 0);
    const playerNames: string[] = [];

    for (const line of lines) {
      // Skip lines that are clearly not player lists
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes("error") || 
          lowerLine.includes("unknown command") ||
          lowerLine.includes("permission denied") ||
          lowerLine.includes("usage:") ||
          lowerLine.startsWith(">")) {
        continue;
      }

      // Pattern 0: Hytale-specific format: "default (1): : Onyxhunter (Onyxhunter)"
      // Format: "worldname (count): : PlayerName (DisplayName)"
      const hytalePattern = /^\w+\s+\(\d+\):\s*:\s*(.+)$/;
      const hytaleMatch = line.match(hytalePattern);
      if (hytaleMatch && hytaleMatch[1]) {
        // Extract players from "Onyxhunter (Onyxhunter)" or "Player1 (Name1), Player2 (Name2)"
        const playersPart = hytaleMatch[1].trim();
        // Split by comma if multiple players, then extract first part before parentheses
        const players = playersPart.split(",").map(p => {
          let trimmed = p.trim();
          // Strip any remaining ANSI codes
          trimmed = this.stripAnsiCodes(trimmed).trim();
          // Extract name before parentheses: "Onyxhunter (Onyxhunter)" -> "Onyxhunter"
          const nameMatch = trimmed.match(/^([^(]+?)(?:\s*\([^)]+\))?$/);
          return (nameMatch && nameMatch[1]) ? nameMatch[1].trim() : trimmed;
        }).filter(p => p.length > 0 && this.isValidPlayerName(p));
        playerNames.push(...players);
        continue;
      }

      // Pattern 1: "There are X of a max of Y players online: Player1, Player2"
      const pattern1 = /(?:there\s+are\s+\d+\s+of\s+a\s+max\s+of\s+\d+\s+)?players?\s+online[:\s]+(.*)/i;
      const match1 = line.match(pattern1);
      if (match1 && match1[1]) {
        const players = match1[1].split(",").map(p => this.stripAnsiCodes(p.trim())).filter(p => this.isValidPlayerName(p));
        playerNames.push(...players);
        continue;
      }

      // Pattern 1b: "X players online: Player1, Player2"
      const pattern1b = /\d+\s+players?\s+online[:\s]+(.*)/i;
      const match1b = line.match(pattern1b);
      if (match1b && match1b[1]) {
        const players = match1b[1].split(",").map(p => this.stripAnsiCodes(p.trim())).filter(p => this.isValidPlayerName(p));
        playerNames.push(...players);
        continue;
      }

      // Pattern 2: "Player1, Player2, Player3" (comma-separated list)
      // Only if it looks like a list (has commas and reasonable length)
      if (line.includes(",") && line.length > 3 && !lowerLine.includes("command") && !lowerLine.includes("usage")) {
        const players = line.split(",").map(p => this.stripAnsiCodes(p.trim())).filter(p => this.isValidPlayerName(p));
        // Heuristic: if all parts are valid player names
        if (players.length > 0 && players.every(p => this.isValidPlayerName(p))) {
          playerNames.push(...players);
          continue;
        }
      }

      // Pattern 3: Lines with player names separated by spaces (if no commas)
      // "Player1 Player2 Player3" format
      if (!line.includes(",") && line.length > 3 && line.length < 200) {
        const words = line.split(/\s+/).filter(w => w.length > 0).map(w => this.stripAnsiCodes(w));
        // Check if all words are valid player names
        if (words.length > 0 && words.length <= 20 && words.every(w => this.isValidPlayerName(w))) {
          // Skip if it looks like a command or system message
          if (!lowerLine.includes("online") && !lowerLine.includes("players") && !lowerLine.includes("server")) {
            playerNames.push(...words);
            continue;
          }
        }
      }

      // Pattern 4: Single player name on a line (if it looks like a name)
      const cleanLine = this.stripAnsiCodes(line);
      if (this.isValidPlayerName(cleanLine) && !lowerLine.includes("player") && !lowerLine.includes("online")) {
        playerNames.push(cleanLine);
      }
    }

    // Remove duplicates and return
    return Array.from(new Set(playerNames));
  }

  /**
   * Get count of players for a server
   */
  getPlayerCount(serverId: string): number {
    const serverPlayers = this.players.get(serverId);
    return serverPlayers ? serverPlayers.size : 0;
  }

  /**
   * Get total count of players across all servers
   */
  getTotalPlayerCount(): number {
    let total = 0;
    for (const serverPlayers of this.players.values()) {
      total += serverPlayers.size;
    }
    return total;
  }
}

// Singleton instance
let playerTrackerInstance: PlayerTracker | null = null;

export function getPlayerTracker(): PlayerTracker {
  if (!playerTrackerInstance) {
    playerTrackerInstance = new PlayerTracker();
  }
  return playerTrackerInstance;
}
