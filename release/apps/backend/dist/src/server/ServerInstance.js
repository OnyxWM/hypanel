import { spawn } from "child_process";
import { updateServerStatus, insertConsoleLog, insertServerStats, getServer } from "../database/db.js";
import { getServerLogger, logServerStart, logServerStop, logError } from "../logger/Logger.js";
import pidusage from "pidusage";
import { EventEmitter } from "events";
import path from "path";
import os from "os";
import { createServerError, createFilesystemError, HypanelError } from "../errors/index.js";
import { config as appConfig } from "../config/config.js";
import { getPlayerTracker } from "./PlayerTracker.js";
export class ServerInstance extends EventEmitter {
    id;
    config;
    process;
    status;
    statsInterval = null;
    logger;
    playerCount = 0;
    playerTracker = getPlayerTracker();
    constructor(config) {
        super();
        this.id = config.id;
        this.config = config;
        this.process = {
            pid: null,
            startTime: null,
            process: null,
        };
        this.status = "offline";
        this.logger = getServerLogger(this.id);
    }
    async start() {
        logServerStart(this.id, "validation", "Starting server process");
        if (this.status === "online" || this.status === "starting") {
            const error = createServerError("start", `Server is already ${this.status}`, this.id, "Stop the server first before starting it again");
            logError(error, "start", this.id);
            throw error;
        }
        this.status = "starting";
        this.emit("statusChange", this.status);
        updateServerStatus(this.id, this.status);
        try {
            const executable = this.config.executable || "java";
            const fs = await import("fs/promises");
            // Get server data from database to retrieve stored jarPath and assetsPath
            const dbServer = getServer(this.id);
            if (!dbServer) {
                const error = createServerError("start", "Server not found in database", this.id);
                logError(error, "start", this.id);
                throw error;
            }
            // Verify server is installed
            if (dbServer.installState !== "INSTALLED") {
                const error = createServerError("start", `Server is not installed. Current state: ${dbServer.installState}`, this.id, "Install the server first before attempting to start it");
                logError(error, "start", this.id);
                throw error;
            }
            // Use stored paths from database
            const jarPath = dbServer.jarPath;
            const assetsPath = dbServer.assetsPath;
            if (!jarPath) {
                const error = createServerError("start", "Server jar path not found in database", this.id, "Reinstall the server to ensure proper configuration");
                logError(error, "start", this.id);
                throw error;
            }
            if (!assetsPath) {
                const error = createServerError("start", "Server assets path not found in database", this.id, "Reinstall the server to ensure proper configuration");
                logError(error, "start", this.id);
                throw error;
            }
            // Verify jar file exists
            try {
                await fs.access(jarPath);
            }
            catch {
                const error = createFilesystemError("access", jarPath, "JAR file not found", this.id);
                logError(error, "start", this.id);
                throw error;
            }
            // Verify assets file exists
            try {
                await fs.access(assetsPath);
            }
            catch {
                const error = createFilesystemError("access", assetsPath, "Assets file not found", this.id);
                logError(error, "start", this.id);
                throw error;
            }
            // Determine working directory (server root)
            let workingDir = dbServer.serverRoot || this.config.path;
            if (!workingDir) {
                throw new Error(`Server working directory not configured`);
            }
            // Expand ~ in paths
            if (workingDir.startsWith("~")) {
                const os = await import("os");
                workingDir = path.join(os.homedir(), workingDir.slice(1));
            }
            // Ensure working directory exists
            try {
                await fs.access(workingDir);
            }
            catch {
                await fs.mkdir(workingDir, { recursive: true });
                this.logger.info(`Created working directory: ${workingDir}`);
            }
            // Build command args using official Hytale launch requirements
            // Calculate max memory in GB
            const maxMemoryGB = Math.max(1, Math.round(this.config.maxMemory / 1024)); // Ensure at least 1GB
            // Initial heap size: use 4GB if maxMemory > 4GB, otherwise use maxMemory-1GB (but at least 1GB) to ensure Xms < Xmx
            // If maxMemory is exactly 4GB, use 3GB for initial to ensure Xms < Xmx
            let initialHeapGB;
            if (maxMemoryGB >= 5) {
                initialHeapGB = 4; // Use 4GB for initial if max is 5GB or more
            }
            else if (maxMemoryGB === 4) {
                initialHeapGB = 3; // Use 3GB for initial if max is exactly 4GB
            }
            else {
                initialHeapGB = Math.max(1, maxMemoryGB - 1); // Use max-1GB, but at least 1GB
            }
            // Ensure initialHeapGB is never greater than or equal to maxMemoryGB
            if (initialHeapGB >= maxMemoryGB) {
                initialHeapGB = Math.max(1, maxMemoryGB - 1);
            }
            this.logger.info(`Memory settings: maxMemory=${this.config.maxMemory}MB, maxMemoryGB=${maxMemoryGB}G, initialHeapGB=${initialHeapGB}G`);
            const args = [
                `-Xms${initialHeapGB}G`, // Initial heap size (always < Xmx)
                `-Xmx${maxMemoryGB}G`, // Max memory from config (MB to GB)
            ];
            if (this.config.aotCacheEnabled === true) {
                // Ahead-of-time caching (writes/uses cache file in working directory)
                args.push("-XX:AOTCache=HytaleServer.aot");
            }
            args.push("-jar", jarPath, "--assets", assetsPath);
            // Application args (after -jar): passed to Hytale server, not the JVM
            if (this.config.acceptEarlyPlugins === true) {
                args.push("--accept-early-plugins");
            }
            // Add bind address (default to 0.0.0.0:port if not specified)
            const bindAddress = this.config.bindAddress || this.config.ip || "0.0.0.0";
            args.push("--bind", `${bindAddress}:${this.config.port}`);
            // Always add backup directory argument
            const backupDir = appConfig.backupDir;
            const serverBackupDir = path.join(backupDir, `${this.id}-back`);
            // Ensure the backup directory exists even if backups are disabled.
            // (We still pass --backup-dir to the server process.)
            try {
                await fs.mkdir(serverBackupDir, { recursive: true, mode: 0o755 });
            }
            catch (e) {
                this.logger.warn(`Failed to ensure backup directory exists (${serverBackupDir}): ${e instanceof Error ? e.message : String(e)}`);
            }
            args.push("--backup-dir", serverBackupDir);
            // Add --backup flag and backup settings only if backups are enabled
            if (this.config.backupEnabled === true) {
                args.push("--backup");
                args.push("--backup-frequency", String(this.config.backupFrequency ?? 30));
                args.push("--backup-max-count", String(this.config.backupMaxCount ?? 5));
            }
            // Add optional session tokens
            if (this.config.sessionToken) {
                args.push("--session-token", this.config.sessionToken);
            }
            if (this.config.identityToken) {
                args.push("--identity-token", this.config.identityToken);
            }
            // Add any additional args
            if (this.config.args && this.config.args.length > 0) {
                args.push(...this.config.args);
            }
            // Prepare environment variables
            const env = {
                ...process.env,
                PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
                ...this.config.env
            };
            // Add session tokens to environment if not already present
            if (this.config.sessionToken && !env.HYTALE_SERVER_SESSION_TOKEN) {
                env.HYTALE_SERVER_SESSION_TOKEN = this.config.sessionToken;
            }
            if (this.config.identityToken && !env.HYTALE_SERVER_IDENTITY_TOKEN) {
                env.HYTALE_SERVER_IDENTITY_TOKEN = this.config.identityToken;
            }
            this.logger.info(`Starting server with official Hytale command: ${executable} ${args.join(" ")}`);
            this.logger.info(`Working directory: ${workingDir}`);
            this.logger.info(`Using jar: ${jarPath}`);
            this.logger.info(`Using assets: ${assetsPath}`);
            const childProcess = spawn(executable, args, {
                cwd: workingDir,
                env,
                stdio: ["pipe", "pipe", "pipe"],
            });
            this.process = {
                pid: childProcess.pid || null,
                startTime: Date.now(),
                process: childProcess,
            };
            // Handle stdout
            childProcess.stdout?.on("data", (data) => {
                const message = data.toString();
                this.handleLogOutput(message, "info");
            });
            // Handle stderr
            childProcess.stderr?.on("data", (data) => {
                const message = data.toString();
                this.handleLogOutput(message, "error");
            });
            // Handle process exit
            childProcess.on("exit", (code, signal) => {
                this.logger.info(`Server process exited with code ${code}, signal ${signal}`);
                this.handleProcessExit(code, signal);
            });
            // Handle process error
            childProcess.on("error", (error) => {
                this.logger.error(`Server process error: ${error.message}`);
                this.handleProcessError(error);
            });
            // Wait a bit to see if process starts successfully
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    const error = createServerError("start", "Server failed to start within timeout", this.id, "Check server logs for startup errors and ensure system resources are sufficient");
                    logError(error, "start", this.id);
                    reject(error);
                }, 10000);
                childProcess.once("spawn", () => {
                    clearTimeout(timeout);
                    logServerStart(this.id, "process_spawn", "Server process spawned successfully");
                    resolve();
                });
                childProcess.once("error", (error) => {
                    clearTimeout(timeout);
                    const structuredError = createServerError("start", `Process spawn failed: ${error.message}`, this.id, "Check executable path and system permissions");
                    logError(structuredError, "start", this.id);
                    reject(structuredError);
                });
            });
            this.status = "online";
            this.emit("statusChange", this.status);
            updateServerStatus(this.id, this.status, this.process.pid);
            // Start resource monitoring
            this.startResourceMonitoring();
            logServerStart(this.id, "complete", `Server started successfully with PID ${this.process.pid}`, {
                pid: this.process.pid,
                jarPath,
                assetsPath
            });
        }
        catch (error) {
            this.status = "offline";
            this.emit("statusChange", this.status);
            updateServerStatus(this.id, this.status);
            if (error instanceof HypanelError) {
                logError(error, "start", this.id, error.context);
            }
            else {
                const genericError = createServerError("start", error instanceof Error ? error.message : "Unknown error", this.id);
                logError(genericError, "start", this.id);
            }
            throw error;
        }
    }
    async stop(force = false) {
        logServerStop(this.id, "validation", `Stopping server (force: ${force})`);
        if (this.status === "offline" || this.status === "stopping") {
            logServerStop(this.id, "validation", `Server already ${this.status}, skipping stop`);
            return;
        }
        this.status = "stopping";
        this.emit("statusChange", this.status);
        updateServerStatus(this.id, this.status);
        // Stop resource monitoring
        this.stopResourceMonitoring();
        if (!this.process.process || !this.process.pid) {
            this.status = "offline";
            this.emit("statusChange", this.status);
            updateServerStatus(this.id, this.status);
            logServerStop(this.id, "validation", "No running process found, marking as offline");
            return;
        }
        try {
            const pid = this.process.pid;
            logServerStop(this.id, "signal", `Sending ${force ? 'SIGKILL' : 'SIGTERM'} to PID ${pid}`);
            if (force) {
                this.process.process.kill("SIGKILL");
            }
            else {
                this.process.process.kill("SIGTERM");
                // Wait for graceful shutdown
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        logServerStop(this.id, "force_kill", "Server did not stop gracefully, forcing kill", { pid });
                        if (this.process.process) {
                            this.process.process.kill("SIGKILL");
                        }
                        resolve();
                    }, 10000);
                    this.process.process.once("exit", () => {
                        clearTimeout(timeout);
                        logServerStop(this.id, "graceful_exit", "Server stopped gracefully", { pid });
                        resolve();
                    });
                    this.process.process.once("error", (error) => {
                        clearTimeout(timeout);
                        const structuredError = createServerError("stop", `Stop failed: ${error.message}`, this.id);
                        logError(structuredError, "stop", this.id);
                        reject(structuredError);
                    });
                });
            }
            this.status = "offline";
            this.emit("statusChange", this.status);
            updateServerStatus(this.id, this.status, null);
            this.process = {
                pid: null,
                startTime: null,
                process: null,
            };
            this.logger.info("Server stopped successfully");
        }
        catch (error) {
            this.logger.error(`Error stopping server: ${error}`);
            throw error;
        }
    }
    async restart() {
        this.logger.info("Restarting server");
        await this.stop();
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
        await this.start();
    }
    sendCommand(command) {
        // Allow commands when server is online or auth_required (needed for authentication)
        if (!this.process.process || (this.status !== "online" && this.status !== "auth_required")) {
            throw new Error(`Cannot send command: server is ${this.status}`);
        }
        if (!this.process.process.stdin) {
            throw new Error("Server process stdin is not available");
        }
        this.logger.info(`Sending command: ${command}`);
        this.process.process.stdin.write(command + "\n");
        // Log the command (don't let database errors prevent command from being sent)
        try {
            insertConsoleLog({
                serverId: this.id,
                timestamp: new Date(),
                level: "info",
                message: `> ${command}`,
            });
        }
        catch (error) {
            this.logger.error(`Failed to log command to database: ${error instanceof Error ? error.message : "Unknown error"}`);
            // Continue execution - command was already sent
        }
        this.emit("command", command);
    }
    getStatus() {
        return this.status;
    }
    getProcess() {
        return { ...this.process };
    }
    handleLogOutput(message, defaultLevel) {
        const lines = message.split("\n").filter((line) => line.trim());
        for (const line of lines) {
            // Strip ANSI escape codes before processing
            const cleanedLine = this.stripAnsiCodes(line);
            let level = defaultLevel;
            // Try to parse log level from the message
            const lowerLine = cleanedLine.toLowerCase();
            if (lowerLine.includes("error") || lowerLine.includes("exception")) {
                level = "error";
            }
            else if (lowerLine.includes("warn") || lowerLine.includes("warning")) {
                level = "warning";
            }
            // Check for authentication requirements
            this.checkAuthRequirements(lowerLine);
            // Player tracking is now done exclusively via /who command polling
            // No longer parsing player join/leave events from logs to avoid false positives
            // Log to file (use cleaned line)
            if (level === "error") {
                this.logger.error(cleanedLine);
            }
            else if (level === "warning") {
                this.logger.warn(cleanedLine);
            }
            else {
                this.logger.info(cleanedLine);
            }
            // Store in database (use cleaned line)
            insertConsoleLog({
                serverId: this.id,
                timestamp: new Date(),
                level,
                message: cleanedLine,
            });
            // Emit log event (use cleaned line)
            this.emit("log", {
                id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
                timestamp: new Date(),
                level,
                message: cleanedLine,
            });
        }
    }
    /**
     * Strip ANSI escape codes from a string
     * Handles all ANSI escape sequences including color codes, cursor movements, etc.
     */
    stripAnsiCodes(str) {
        // Remove ANSI escape codes:
        // - \u001b[ or \x1b[ followed by optional parameters and a command character
        // - Common command characters: m (formatting/colors), H (cursor), J (erase), K (erase line), etc.
        // - Also handles CSI (Control Sequence Introducer) codes
        return str
            .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '') // Unicode escape sequences
            .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // Hex escape sequences
            .replace(/\u001b\[[0-9;]*m/g, '') // Unicode formatting codes (backward compatibility)
            .replace(/\x1b\[[0-9;]*m/g, ''); // Hex formatting codes (backward compatibility)
    }
    /**
     * Parse player join/leave events from log lines
     * Extracts player names from various log formats
     */
    parsePlayerEvents(line, lowerLine) {
        // Player join patterns - Hytale-specific format: Player 'PLAYERNAME' joined world 'WORLDNAME'
        const joinPatterns = [
            /player\s+['"]([^'"]+)['"]\s+joined\s+world/i, // Player 'Onyxhunter' joined world 'default'
            /\[.*?\]\s*(\w+(?:\s+\w+)*)\s+joined/i, // [timestamp] PlayerName joined
            /(\w+(?:\s+\w+)*)\s+joined\s+the\s+game/i,
            /(\w+(?:\s+\w+)*)\s+joined/i,
            /(\w+(?:\s+\w+)*)\s+connected/i,
            /(\w+(?:\s+\w+)*)\s+logged\s+in/i,
            /player\s+(\w+(?:\s+\w+)*)\s+joined/i,
            /(\w+(?:\s+\w+)*)\s+has\s+joined/i,
            /(\w+(?:\s+\w+)*)\s+entered/i,
            /(\w+(?:\s+\w+)*)\s+connected\s+to\s+the\s+server/i,
            // Hytale-specific patterns
            /(\w+(?:\s+\w+)*)\s+has\s+connected/i,
            /connection\s+from\s+(\w+(?:\s+\w+)*)/i,
        ];
        // Player leave patterns - Hytale may use similar format with 'left world'
        const leavePatterns = [
            /player\s+['"]([^'"]+)['"]\s+left\s+world/i, // Player 'Onyxhunter' left world 'default'
            /\[.*?\]\s*(\w+(?:\s+\w+)*)\s+left/i, // [timestamp] PlayerName left
            /(\w+(?:\s+\w+)*)\s+left\s+the\s+game/i,
            /(\w+(?:\s+\w+)*)\s+left/i,
            /(\w+(?:\s+\w+)*)\s+disconnected/i,
            /(\w+(?:\s+\w+)*)\s+logged\s+out/i,
            /player\s+(\w+(?:\s+\w+)*)\s+left/i,
            /(\w+(?:\s+\w+)*)\s+has\s+left/i,
            /(\w+(?:\s+\w+)*)\s+quit/i,
            /(\w+(?:\s+\w+)*)\s+disconnected\s+from\s+the\s+server/i,
            // Hytale-specific patterns
            /(\w+(?:\s+\w+)*)\s+has\s+disconnected/i,
            /lost\s+connection\s+to\s+(\w+(?:\s+\w+)*)/i,
        ];
        // Check for join events
        for (const pattern of joinPatterns) {
            const match = line.match(pattern);
            if (match && match[1]) {
                let playerName = match[1].trim();
                // Strip ANSI escape codes from player name
                playerName = this.stripAnsiCodes(playerName).trim();
                // Validate player name (reasonable length, no special chars except common ones)
                // Hytale player names can be any characters except quotes, but we'll validate more strictly
                if (playerName.length > 0 && playerName.length <= 32 && /^[a-zA-Z0-9_\- ]+$/.test(playerName)) {
                    this.logger.info(`Detected player join: ${playerName} on server ${this.id}`);
                    this.playerTracker.addPlayer(this.id, playerName);
                    return;
                }
            }
        }
        // Check for leave events
        for (const pattern of leavePatterns) {
            const match = line.match(pattern);
            if (match && match[1]) {
                let playerName = match[1].trim();
                // Strip ANSI escape codes from player name
                playerName = this.stripAnsiCodes(playerName).trim();
                // Validate player name
                if (playerName.length > 0 && playerName.length <= 32 && /^[a-zA-Z0-9_\- ]+$/.test(playerName)) {
                    this.logger.info(`Detected player leave: ${playerName} on server ${this.id}`);
                    this.playerTracker.removePlayer(this.id, playerName);
                    return;
                }
            }
        }
    }
    checkAuthRequirements(line) {
        // Detect authentication requirement patterns in Hytale server output
        const authPatterns = [
            /authentication required/i,
            /please authenticate/i,
            /auth login required/i,
            /use \/auth login/i,
            /run \/auth login device/i,
            /authentication token needed/i,
            /login required to continue/i,
            /please run \/auth/i,
            /auth: login required/i,
            /server requires authentication/i
        ];
        // Check if any auth pattern matches
        for (const pattern of authPatterns) {
            if (pattern.test(line)) {
                // Set status to auth_required if not already set
                if (this.status !== "auth_required") {
                    this.logger.info(`Authentication required detected: ${line}`);
                    this.status = "auth_required";
                    this.emit("statusChange", this.status);
                    updateServerStatus(this.id, this.status);
                }
                return;
            }
        }
        // Check for successful authentication patterns
        const authSuccessPatterns = [
            /authentication successful/i,
            /auth login successful/i,
            /successfully authenticated/i,
            /login completed/i,
            /authentication verified/i
        ];
        for (const pattern of authSuccessPatterns) {
            if (pattern.test(line) && this.status === "auth_required") {
                this.logger.info(`Authentication successful detected: ${line}`);
                this.status = "online";
                this.emit("statusChange", this.status);
                updateServerStatus(this.id, this.status);
                return;
            }
        }
    }
    handleProcessExit(code, signal) {
        this.stopResourceMonitoring();
        this.status = "offline";
        this.playerCount = 0; // Reset player count on exit
        // Clear all players when server stops
        this.playerTracker.clearServerPlayers(this.id);
        this.emit("statusChange", this.status);
        updateServerStatus(this.id, this.status, null);
        this.process = {
            pid: null,
            startTime: null,
            process: null,
        };
        this.emit("exit", code, signal);
    }
    handleProcessError(error) {
        this.stopResourceMonitoring();
        this.status = "offline";
        this.playerCount = 0; // Reset player count on error
        // Clear all players when server errors
        this.playerTracker.clearServerPlayers(this.id);
        this.emit("statusChange", this.status);
        updateServerStatus(this.id, this.status, null);
        this.emit("error", error);
    }
    startResourceMonitoring() {
        if (this.statsInterval) {
            return;
        }
        this.statsInterval = setInterval(async () => {
            if (!this.process.pid || this.status !== "online") {
                return;
            }
            try {
                const stats = await pidusage(this.process.pid);
                const uptime = this.process.startTime
                    ? Math.floor((Date.now() - this.process.startTime) / 1000)
                    : 0;
                // Store stats in database
                // Get accurate player count from PlayerTracker instead of internal counter
                const actualPlayerCount = this.playerTracker.getPlayerCount(this.id);
                const totalCores = Math.max(1, os.cpus()?.length || 1);
                // pidusage cpu can exceed 100% on multi-core; normalize to 0–100% of total host capacity
                const normalizedCpu = Math.max(0, Math.min(100, stats.cpu / totalCores));
                const memoryMB = stats.memory / 1024 / 1024; // RSS bytes -> MB
                insertServerStats({
                    serverId: this.id,
                    timestamp: Date.now(),
                    cpu: normalizedCpu,
                    memory: memoryMB,
                    players: actualPlayerCount,
                    maxPlayers: this.config.maxPlayers,
                });
                // Emit stats event
                this.emit("stats", {
                    cpu: normalizedCpu,
                    memory: memoryMB,
                    uptime,
                    players: actualPlayerCount,
                });
            }
            catch (error) {
                // Process might have exited
                if (error instanceof Error && error.message.includes("No such process")) {
                    this.handleProcessExit(null, null);
                }
            }
        }, 5000); // Poll every 5 seconds
    }
    stopResourceMonitoring() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
    }
    destroy() {
        this.stopResourceMonitoring();
        if (this.process.process && this.status !== "offline") {
            this.process.process.kill("SIGKILL");
        }
        this.removeAllListeners();
    }
}
//# sourceMappingURL=ServerInstance.js.map