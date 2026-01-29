import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { config } from "../config/config.js";
const execFileAsync = promisify(execFile);
const SYSTEMCTL_PATH = "/usr/bin/systemctl";
const JOURNALCTL_PATH = "/usr/bin/journalctl";
export const HYPANEL_SYSTEMD_UNIT = "hypanel";
function decodeJournalField(value) {
    if (typeof value === "string")
        return value;
    // journalctl -o json may emit raw bytes as an array of integers for non-utf8 fields
    if (Array.isArray(value) && value.every((x) => typeof x === "number")) {
        try {
            return Buffer.from(value).toString("utf8");
        }
        catch {
            return String(value);
        }
    }
    return String(value ?? "");
}
function stripAnsi(input) {
    // Basic CSI + OSC stripping. Keeps logs readable in the UI.
    return input
        .replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "")
        .replace(/\u001B\][^\u0007]*\u0007/g, "");
}
function priorityToLevel(priority) {
    const n = typeof priority === "string" ? Number.parseInt(priority, 10) : priority;
    if (Number.isFinite(n)) {
        if (n <= 3)
            return "error"; // emerg/alert/crit/err
        if (n === 4)
            return "warning";
        return "info";
    }
    return "info";
}
function realtimeMicrosToMs(value) {
    if (typeof value !== "string")
        return Date.now();
    const micros = Number.parseInt(value, 10);
    if (!Number.isFinite(micros))
        return Date.now();
    return Math.floor(micros / 1000);
}
/**
 * Detect if we're running in a Docker container
 * Checks for /.dockerenv file (standard Docker indicator)
 */
export function isDockerEnvironment() {
    try {
        return fs.existsSync("/.dockerenv");
    }
    catch {
        return false;
    }
}
/**
 * Read logs from Docker environment (winston log files)
 * Reads from winston daily-rotated log files and converts to JournalEntryWire format
 */
async function readDockerLogs(input) {
    const limit = Math.max(1, Math.min(1000, Math.floor(input.limit)));
    const allEntries = [];
    const logsDir = config.logsDir;
    if (!fs.existsSync(logsDir)) {
        return { entries: [], nextCursor: undefined };
    }
    // Parse cursor: format is "timestamp" (simple timestamp-based cursor)
    let cursorTimestamp;
    if (input.cursor && input.cursor.trim() !== "") {
        // Try to parse as timestamp (first part before any colon)
        const cursorParts = input.cursor.split(":");
        if (cursorParts.length > 0 && cursorParts[0]) {
            const ts = Number.parseInt(cursorParts[0], 10);
            if (Number.isFinite(ts) && ts > 0) {
                cursorTimestamp = ts;
            }
        }
    }
    // Get all log files matching pattern hypanel-YYYY-MM-DD.log
    const logFiles = [];
    try {
        const files = fs.readdirSync(logsDir);
        const logFilePattern = /^hypanel-(\d{4}-\d{2}-\d{2})\.log$/;
        for (const file of files) {
            const match = file.match(logFilePattern);
            if (match && match[1]) {
                logFiles.push({
                    path: path.join(logsDir, file),
                    date: match[1],
                });
            }
        }
        // Sort by date ascending (oldest first) to read chronologically
        logFiles.sort((a, b) => a.date.localeCompare(b.date));
    }
    catch (error) {
        // If we can't read the directory, return empty results
        return { entries: [], nextCursor: undefined };
    }
    // Read all entries from all log files
    for (const logFile of logFiles) {
        try {
            if (!fs.existsSync(logFile.path))
                continue;
            const fileContent = fs.readFileSync(logFile.path, "utf-8");
            const lines = fileContent.split("\n").filter((line) => line.trim());
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex];
                if (!line || !line.trim())
                    continue;
                try {
                    const logEntry = JSON.parse(line);
                    // Only process entries from hypanel service
                    if (logEntry.service !== "hypanel")
                        continue;
                    // Parse timestamp
                    let timestamp;
                    if (logEntry.timestamp) {
                        const date = new Date(logEntry.timestamp);
                        timestamp = date.getTime();
                        if (!Number.isFinite(timestamp)) {
                            timestamp = Date.now();
                        }
                    }
                    else {
                        timestamp = Date.now();
                    }
                    // Skip entries at or before cursor timestamp
                    if (cursorTimestamp !== undefined && timestamp <= cursorTimestamp) {
                        continue;
                    }
                    // Convert winston level to SystemLogLevel
                    let level = "info";
                    const winstonLevel = String(logEntry.level || "").toLowerCase();
                    if (winstonLevel === "error") {
                        level = "error";
                    }
                    else if (winstonLevel === "warn" || winstonLevel === "warning") {
                        level = "warning";
                    }
                    // Extract message
                    const message = stripAnsi(String(logEntry.message || ""));
                    // Create cursor: timestamp (simple format for compatibility)
                    const cursor = String(timestamp);
                    allEntries.push({
                        cursor,
                        timestamp,
                        level,
                        message,
                    });
                }
                catch {
                    // Skip invalid JSON lines
                    continue;
                }
            }
        }
        catch (error) {
            // Skip files we can't read
            continue;
        }
    }
    // Sort entries by timestamp ascending (oldest first) to match journalctl behavior
    allEntries.sort((a, b) => a.timestamp - b.timestamp);
    // If we have a cursor, we want entries after it. Otherwise, get the most recent entries.
    let entries;
    if (cursorTimestamp !== undefined) {
        // Filter to entries after cursor and take up to limit
        entries = allEntries.filter(e => e.timestamp > cursorTimestamp).slice(0, limit);
    }
    else {
        // No cursor: take the last N entries (most recent)
        entries = allEntries.slice(-limit);
    }
    const nextCursor = entries.length > 0 ? entries[entries.length - 1].cursor : input.cursor;
    return {
        entries,
        nextCursor,
    };
}
export async function readUnitJournal(input) {
    // If running in Docker, use winston log files instead of journalctl
    if (isDockerEnvironment()) {
        return readDockerLogs({ limit: input.limit, cursor: input.cursor });
    }
    // Original journalctl implementation for non-Docker environments
    const limit = Math.max(1, Math.min(1000, Math.floor(input.limit)));
    const args = [
        "-u",
        input.unit,
        "--no-pager",
        "-o",
        "json",
        "-n",
        String(limit),
    ];
    if (input.cursor && input.cursor.trim() !== "") {
        args.push(`--after-cursor=${input.cursor}`);
    }
    const { stdout } = await execFileAsync(JOURNALCTL_PATH, args, {
        maxBuffer: 10 * 1024 * 1024,
    });
    const lines = String(stdout)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    const entries = [];
    for (const line of lines) {
        try {
            const obj = JSON.parse(line);
            const cursor = String(obj?.__CURSOR || "").trim();
            if (!cursor)
                continue;
            entries.push({
                cursor,
                timestamp: realtimeMicrosToMs(obj?.__REALTIME_TIMESTAMP),
                level: priorityToLevel(obj?.PRIORITY),
                message: stripAnsi(decodeJournalField(obj?.MESSAGE)),
            });
        }
        catch {
            // Ignore non-JSON lines
        }
    }
    const nextCursor = entries.length > 0 ? entries[entries.length - 1].cursor : input.cursor;
    return { entries, nextCursor };
}
export function queueRestartUnit(input) {
    const delayMs = Math.max(0, Math.floor(input.delayMs ?? 250));
    setTimeout(() => {
        // Best-effort: if this fails, the caller already got a response.
        // Prefer calling systemctl directly (polkit can allow this), since sudo is blocked by
        // NoNewPrivileges=true in the hypanel systemd unit.
        execFile(SYSTEMCTL_PATH, ["restart", input.unit], (err) => {
            if (!err)
                return;
            // Fallback for non-systemd/dev contexts where sudo may be allowed.
            execFile("sudo", ["-n", SYSTEMCTL_PATH, "restart", input.unit], (sudoErr) => {
                if (sudoErr) {
                    // eslint-disable-next-line no-console
                    console.warn(`Failed to restart systemd unit ${input.unit}:`, sudoErr);
                }
            });
        });
    }, delayMs);
}
//# sourceMappingURL=systemd.js.map