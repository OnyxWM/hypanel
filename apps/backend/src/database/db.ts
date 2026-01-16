import Database from "better-sqlite3";
import { config } from "../config/config.js";
import { Server, ServerStatus, ConsoleLog, ServerStats } from "../types/index.js";
import path from "path";
import fs from "fs";

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  // Ensure database directory exists
  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      pid INTEGER,
      ip TEXT NOT NULL,
      port INTEGER NOT NULL,
      version TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      install_state TEXT DEFAULT 'NOT_INSTALLED',
      last_error TEXT,
      jar_path TEXT,
      assets_path TEXT,
      server_root TEXT
    );

    CREATE TABLE IF NOT EXISTS server_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      cpu REAL NOT NULL,
      memory REAL NOT NULL,
      players INTEGER NOT NULL,
      max_players INTEGER NOT NULL,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS console_logs (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_server_stats_server_id ON server_stats(server_id);
    CREATE INDEX IF NOT EXISTS idx_server_stats_timestamp ON server_stats(timestamp);
    CREATE INDEX IF NOT EXISTS idx_console_logs_server_id ON console_logs(server_id);
    CREATE INDEX IF NOT EXISTS idx_console_logs_timestamp ON console_logs(timestamp);
  `);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Server operations
export function createServer(server: Omit<Server, "players" | "cpu" | "memory" | "uptime">): void {
  const database = getDatabase();
  const stmt = database.prepare(`
    INSERT INTO servers (id, name, status, pid, ip, port, version, created_at, updated_at, install_state, last_error, jar_path, assets_path, server_root)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  stmt.run(
    server.id,
    server.name,
    server.status,
    null,
    server.ip,
    server.port,
    server.version || null,
    now,
    now,
    server.installState || "NOT_INSTALLED",
    server.lastError || null,
    server.jarPath || null,
    server.assetsPath || null,
    server.serverRoot || null
  );
}

export function getServer(id: string): Server | null {
  const database = getDatabase();
  const stmt = database.prepare(`
    SELECT s.*,
           COALESCE(MAX(ss.players), 0) as players,
           COALESCE(MAX(ss.max_players), 0) as max_players,
           COALESCE(MAX(ss.cpu), 0) as cpu,
           COALESCE(MAX(ss.memory), 0) as memory
    FROM servers s
    LEFT JOIN server_stats ss ON s.id = ss.server_id
    WHERE s.id = ?
    GROUP BY s.id
  `);
  const row = stmt.get(id) as any;
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    status: row.status as ServerStatus,
    players: row.players || 0,
    maxPlayers: row.max_players || 0,
    cpu: row.cpu || 0,
    memory: row.memory || 0,
    maxMemory: 0, // Will be set from config
    uptime: 0, // Will be calculated from instance
    ip: row.ip,
    port: row.port,
    version: row.version || "",
    createdAt: new Date(row.created_at).toISOString(),
    installState: row.install_state as any,
    lastError: row.last_error,
    jarPath: row.jar_path,
    assetsPath: row.assets_path,
    serverRoot: row.server_root,
  };
}

export function getAllServers(): Server[] {
  const database = getDatabase();
  const stmt = database.prepare(`
    SELECT s.*,
           COALESCE(MAX(ss.players), 0) as players,
           COALESCE(MAX(ss.max_players), 0) as max_players,
           COALESCE(MAX(ss.cpu), 0) as cpu,
           COALESCE(MAX(ss.memory), 0) as memory
    FROM servers s
    LEFT JOIN server_stats ss ON s.id = ss.server_id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `);
  const rows = stmt.all() as any[];

  return rows.map((row) => {
    return {
      id: row.id,
      name: row.name,
      status: row.status as ServerStatus,
      players: row.players || 0,
      maxPlayers: row.max_players || 0,
      cpu: row.cpu || 0,
      memory: row.memory || 0,
      maxMemory: 0, // Will be set from config
      uptime: 0, // Will be calculated from instance
      ip: row.ip,
      port: row.port,
      version: row.version || "",
      createdAt: new Date(row.created_at).toISOString(),
      installState: row.install_state as any,
      lastError: row.last_error,
      jarPath: row.jar_path,
      assetsPath: row.assets_path,
      serverRoot: row.server_root,
    };
  });
}

export function updateServerStatus(id: string, status: ServerStatus, pid: number | null = null): void {
  const database = getDatabase();
  const stmt = database.prepare(`
    UPDATE servers
    SET status = ?, pid = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(status, pid, Date.now(), id);
}

export function updateServerInstallState(id: string, installState: any, lastError?: string, jarPath?: string, assetsPath?: string): void {
  const database = getDatabase();
  const stmt = database.prepare(`
    UPDATE servers
    SET install_state = ?, last_error = ?, jar_path = ?, assets_path = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(installState, lastError || null, jarPath || null, assetsPath || null, Date.now(), id);
}

export function updateServerPaths(id: string, serverRoot: string): void {
  const database = getDatabase();
  const stmt = database.prepare(`
    UPDATE servers
    SET server_root = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(serverRoot, Date.now(), id);
}

export function deleteServer(id: string): void {
  const database = getDatabase();
  const stmt = database.prepare("DELETE FROM servers WHERE id = ?");
  stmt.run(id);
}

// Stats operations
export function insertServerStats(stats: ServerStats): void {
  const database = getDatabase();
  const stmt = database.prepare(`
    INSERT INTO server_stats (server_id, timestamp, cpu, memory, players, max_players)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    stats.serverId,
    stats.timestamp,
    stats.cpu,
    stats.memory,
    stats.players,
    stats.maxPlayers
  );
}

export function getServerStats(serverId: string, limit: number = 100): ServerStats[] {
  const database = getDatabase();
  const stmt = database.prepare(`
    SELECT server_id as serverId, timestamp, cpu, memory, players, max_players as maxPlayers
    FROM server_stats
    WHERE server_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  const rows = stmt.all(serverId, limit) as any[];
  return rows.map((row) => ({
    serverId: row.serverId,
    timestamp: row.timestamp,
    cpu: row.cpu,
    memory: row.memory,
    players: row.players,
    maxPlayers: row.maxPlayers,
  }));
}

// Console log operations
export function insertConsoleLog(log: Omit<ConsoleLog, "id"> & { serverId: string }): void {
  const database = getDatabase();
  const id = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const stmt = database.prepare(`
    INSERT INTO console_logs (id, server_id, timestamp, level, message)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, log.serverId, log.timestamp.getTime(), log.level, log.message);
}

export function getConsoleLogs(serverId: string, limit: number = 1000): ConsoleLog[] {
  const database = getDatabase();
  const stmt = database.prepare(`
    SELECT id, timestamp, level, message
    FROM console_logs
    WHERE server_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  const rows = stmt.all(serverId, limit) as any[];
  return rows.map((row) => ({
    id: row.id,
    timestamp: new Date(row.timestamp),
    level: row.level as "info" | "warning" | "error",
    message: row.message,
  })).reverse(); // Reverse to get chronological order
}
