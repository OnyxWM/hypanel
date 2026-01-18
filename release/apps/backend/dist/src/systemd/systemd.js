import { execFile } from "child_process";
import { promisify } from "util";
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
export async function readUnitJournal(input) {
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