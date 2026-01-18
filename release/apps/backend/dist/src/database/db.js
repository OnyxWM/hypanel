import Database from "better-sqlite3";
import { config } from "../config/config.js";
import path from "path";
import fs from "fs";
let db = null;
export function initDatabase() {
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
      server_root TEXT,
      autostart INTEGER NOT NULL DEFAULT 0
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

    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      join_time INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      server_id TEXT,
      server_name TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_server_stats_server_id ON server_stats(server_id);
    CREATE INDEX IF NOT EXISTS idx_server_stats_timestamp ON server_stats(timestamp);
    CREATE INDEX IF NOT EXISTS idx_console_logs_server_id ON console_logs(server_id);
    CREATE INDEX IF NOT EXISTS idx_console_logs_timestamp ON console_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_players_server_id ON players(server_id);
    CREATE INDEX IF NOT EXISTS idx_players_name ON players(player_name);
    CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
  `);
    // Best-effort migration for older installs: add servers.autostart if missing.
    // (CREATE TABLE IF NOT EXISTS won't alter existing tables.)
    try {
        const cols = db.prepare(`PRAGMA table_info(servers)`).all();
        const hasAutostart = Array.isArray(cols) && cols.some((c) => c?.name === "autostart");
        if (!hasAutostart) {
            db.exec(`ALTER TABLE servers ADD COLUMN autostart INTEGER NOT NULL DEFAULT 0;`);
        }
    }
    catch {
        // Ignore migration errors; absence will be handled as default false in reads.
    }
    return db;
}
export function getDatabase() {
    if (!db) {
        throw new Error("Database not initialized. Call initDatabase() first.");
    }
    return db;
}
export function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}
// Server operations
export function createServer(server) {
    const database = getDatabase();
    const stmt = database.prepare(`
    INSERT INTO servers (id, name, status, pid, ip, port, version, created_at, updated_at, install_state, last_error, jar_path, assets_path, server_root, autostart)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const now = Date.now();
    stmt.run(server.id, server.name, server.status, null, server.ip, server.port, server.version || null, now, now, server.installState || "NOT_INSTALLED", server.lastError || null, server.jarPath || null, server.assetsPath || null, server.serverRoot || null, server.autostart ? 1 : 0);
}
export function getServer(id) {
    const database = getDatabase();
    const stmt = database.prepare(`
    SELECT s.*,
           COALESCE(ss.players, 0) as players,
           COALESCE(ss.max_players, 0) as max_players,
           COALESCE(ss.cpu, 0) as cpu,
           COALESCE(ss.memory, 0) as memory
    FROM servers s
    LEFT JOIN server_stats ss ON ss.id = (
      SELECT id
      FROM server_stats
      WHERE server_id = s.id
      ORDER BY timestamp DESC, id DESC
      LIMIT 1
    )
    WHERE s.id = ?
  `);
    const row = stmt.get(id);
    if (!row)
        return null;
    return {
        id: row.id,
        name: row.name,
        status: row.status,
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
        installState: row.install_state,
        lastError: row.last_error,
        jarPath: row.jar_path,
        assetsPath: row.assets_path,
        serverRoot: row.server_root,
        autostart: Boolean(row.autostart),
    };
}
export function getAllServers() {
    const database = getDatabase();
    const stmt = database.prepare(`
    SELECT s.*,
           COALESCE(ss.players, 0) as players,
           COALESCE(ss.max_players, 0) as max_players,
           COALESCE(ss.cpu, 0) as cpu,
           COALESCE(ss.memory, 0) as memory
    FROM servers s
    LEFT JOIN server_stats ss ON ss.id = (
      SELECT id
      FROM server_stats
      WHERE server_id = s.id
      ORDER BY timestamp DESC, id DESC
      LIMIT 1
    )
    ORDER BY s.created_at DESC
  `);
    const rows = stmt.all();
    return rows.map((row) => {
        return {
            id: row.id,
            name: row.name,
            status: row.status,
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
            installState: row.install_state,
            lastError: row.last_error,
            jarPath: row.jar_path,
            assetsPath: row.assets_path,
            serverRoot: row.server_root,
            autostart: Boolean(row.autostart),
        };
    });
}
export function updateServerStatus(id, status, pid = null) {
    const database = getDatabase();
    const stmt = database.prepare(`
    UPDATE servers
    SET status = ?, pid = ?, updated_at = ?
    WHERE id = ?
  `);
    stmt.run(status, pid, Date.now(), id);
}
export function updateServerInstallState(id, installState, lastError, jarPath, assetsPath) {
    const database = getDatabase();
    const stmt = database.prepare(`
    UPDATE servers
    SET install_state = ?, last_error = ?, jar_path = ?, assets_path = ?, updated_at = ?
    WHERE id = ?
  `);
    stmt.run(installState, lastError || null, jarPath || null, assetsPath || null, Date.now(), id);
}
export function tryStartInstallation(id) {
    const database = getDatabase();
    // First, check current state
    const checkStmt = database.prepare(`
    SELECT install_state FROM servers WHERE id = ?
  `);
    const result = checkStmt.get(id);
    if (!result) {
        return { success: false, reason: "Server not found" };
    }
    const currentState = result.install_state;
    // Can only start installation from NOT_INSTALLED or FAILED states
    if (currentState !== "NOT_INSTALLED" && currentState !== "FAILED") {
        const stateMessages = {
            "INSTALLING": "Installation already in progress",
            "INSTALLED": "Server is already installed"
        };
        return {
            success: false,
            reason: stateMessages[currentState] || `Cannot install from state: ${currentState}`
        };
    }
    // Atomically update to INSTALLING state
    const updateStmt = database.prepare(`
    UPDATE servers 
    SET install_state = 'INSTALLING', last_error = NULL, updated_at = ?
    WHERE id = ? AND install_state IN ('NOT_INSTALLED', 'FAILED')
  `);
    const updateResult = updateStmt.run(Date.now(), id);
    if (updateResult.changes === 0) {
        return { success: false, reason: "Installation state changed concurrently" };
    }
    return { success: true };
}
export function updateServerPaths(id, serverRoot) {
    const database = getDatabase();
    const stmt = database.prepare(`
    UPDATE servers
    SET server_root = ?, updated_at = ?
    WHERE id = ?
  `);
    stmt.run(serverRoot, Date.now(), id);
}
export function updateServerConfig(id, config) {
    const database = getDatabase();
    // Only update fields that are stored in the database
    const updates = [];
    const values = [];
    if (config.name !== undefined) {
        updates.push("name = ?");
        values.push(config.name);
    }
    if (config.ip !== undefined) {
        updates.push("ip = ?");
        values.push(config.ip);
    }
    if (config.port !== undefined) {
        updates.push("port = ?");
        values.push(config.port);
    }
    if (config.version !== undefined) {
        updates.push("version = ?");
        values.push(config.version);
    }
    if (config.autostart !== undefined) {
        updates.push("autostart = ?");
        values.push(config.autostart ? 1 : 0);
    }
    if (updates.length === 0) {
        return; // No database fields to update
    }
    updates.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);
    const stmt = database.prepare(`
    UPDATE servers
    SET ${updates.join(", ")}
    WHERE id = ?
  `);
    stmt.run(...values);
}
export function deleteServer(id) {
    const database = getDatabase();
    const stmt = database.prepare("DELETE FROM servers WHERE id = ?");
    stmt.run(id);
}
// Stats operations
export function insertServerStats(stats) {
    const database = getDatabase();
    const stmt = database.prepare(`
    INSERT INTO server_stats (server_id, timestamp, cpu, memory, players, max_players)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    stmt.run(stats.serverId, stats.timestamp, stats.cpu, stats.memory, stats.players, stats.maxPlayers);
}
export function getServerStats(serverId, limit = 100) {
    const database = getDatabase();
    const stmt = database.prepare(`
    SELECT server_id as serverId, timestamp, cpu, memory, players, max_players as maxPlayers
    FROM server_stats
    WHERE server_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
    const rows = stmt.all(serverId, limit);
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
export function insertConsoleLog(log) {
    const database = getDatabase();
    const id = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const stmt = database.prepare(`
    INSERT INTO console_logs (id, server_id, timestamp, level, message)
    VALUES (?, ?, ?, ?, ?)
  `);
    stmt.run(id, log.serverId, log.timestamp.getTime(), log.level, log.message);
}
export function getConsoleLogs(serverId, limit = 1000) {
    const database = getDatabase();
    const stmt = database.prepare(`
    SELECT id, timestamp, level, message
    FROM console_logs
    WHERE server_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
    const rows = stmt.all(serverId, limit);
    return rows.map((row) => ({
        id: row.id,
        timestamp: new Date(row.timestamp),
        level: row.level,
        message: row.message,
    })).reverse(); // Reverse to get chronological order
}
export function insertNotification(input) {
    const database = getDatabase();
    const createdAtMs = input.createdAt ? new Date(input.createdAt).getTime() : Date.now();
    const stmt = database.prepare(`
    INSERT INTO notifications (id, created_at, type, title, message, server_id, server_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
    stmt.run(input.id, createdAtMs, input.type, input.title, input.message, input.serverId || null, input.serverName || null);
    return {
        id: input.id,
        createdAt: new Date(createdAtMs).toISOString(),
        type: input.type,
        title: input.title,
        message: input.message,
        serverId: input.serverId,
        serverName: input.serverName,
    };
}
export function getNotifications(limit = 50) {
    const database = getDatabase();
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit || 50)));
    const stmt = database.prepare(`
    SELECT id, created_at, type, title, message, server_id, server_name
    FROM notifications
    ORDER BY created_at DESC
    LIMIT ?
  `);
    const rows = stmt.all(safeLimit);
    return rows.map((row) => ({
        id: row.id,
        createdAt: new Date(row.created_at).toISOString(),
        type: row.type,
        title: row.title,
        message: row.message,
        serverId: row.server_id || undefined,
        serverName: row.server_name || undefined,
    }));
}
export function pruneNotifications(maxRows = 1000) {
    const database = getDatabase();
    const safeMax = Math.max(100, Math.min(10000, Math.floor(maxRows || 1000)));
    // Delete everything except the newest `safeMax`
    const stmt = database.prepare(`
    DELETE FROM notifications
    WHERE id NOT IN (
      SELECT id FROM notifications
      ORDER BY created_at DESC
      LIMIT ?
    )
  `);
    stmt.run(safeMax);
}
export function clearNotifications() {
    const database = getDatabase();
    database.prepare(`DELETE FROM notifications`).run();
}
//# sourceMappingURL=db.js.map