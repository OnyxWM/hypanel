import { spawn, ChildProcess } from "child_process";
import { ServerConfig, ServerStatus, ServerProcess } from "../types/index.js";
import { updateServerStatus, insertConsoleLog, insertServerStats } from "../database/db.js";
import { getServerLogger } from "../logger/Logger.js";
import pidusage from "pidusage";
import { EventEmitter } from "events";

export class ServerInstance extends EventEmitter {
  public readonly id: string;
  public readonly config: ServerConfig;
  private process: ServerProcess;
  private status: ServerStatus;
  private statsInterval: NodeJS.Timeout | null = null;
  private logger: ReturnType<typeof getServerLogger>;
  private playerCount: number = 0;

  constructor(config: ServerConfig) {
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

  async start(): Promise<void> {
    if (this.status === "online" || this.status === "starting") {
      throw new Error(`Server ${this.id} is already ${this.status}`);
    }

    this.status = "starting";
    this.emit("statusChange", this.status);
    updateServerStatus(this.id, this.status);

    try {
      const serverPath = this.config.path;
      const executable = this.config.executable || "java";
      
      // Build command args - support Hytale-specific format
      let args: string[] = [];
      
      // If jarFile is specified, assume it's a Java/JAR application (like Hytale)
      if (this.config.jarFile) {
        args.push("-jar", this.config.jarFile);
        
        // Add required Hytale flags if assetsPath is provided
        if (this.config.assetsPath) {
          args.push("--assets", this.config.assetsPath);
        }
        
        // Add bind address (Hytale uses --bind host:port)
        const bindAddress = this.config.bindAddress || this.config.ip || "0.0.0.0";
        args.push("--bind", `${bindAddress}:${this.config.port}`);
        
        // Add authentication tokens if provided
        if (this.config.sessionToken) {
          args.push("--session-token", this.config.sessionToken);
        }
        if (this.config.identityToken) {
          args.push("--identity-token", this.config.identityToken);
        }
      }
      
      // Add any additional custom args
      args.push(...(this.config.args || []));
      
      const env = { ...process.env, ...this.config.env };
      
      // Also set environment variables for tokens if provided (Hytale supports both)
      if (this.config.sessionToken && !env.HYTALE_SERVER_SESSION_TOKEN) {
        env.HYTALE_SERVER_SESSION_TOKEN = this.config.sessionToken;
      }
      if (this.config.identityToken && !env.HYTALE_SERVER_IDENTITY_TOKEN) {
        env.HYTALE_SERVER_IDENTITY_TOKEN = this.config.identityToken;
      }

      this.logger.info(`Starting server: ${executable} ${args.join(" ")}`);

      const childProcess = spawn(executable, args, {
        cwd: serverPath,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.process = {
        pid: childProcess.pid || null,
        startTime: Date.now(),
        process: childProcess,
      };

      // Handle stdout
      childProcess.stdout?.on("data", (data: Buffer) => {
        const message = data.toString();
        this.handleLogOutput(message, "info");
      });

      // Handle stderr
      childProcess.stderr?.on("data", (data: Buffer) => {
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
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Server failed to start within timeout"));
        }, 10000);

        childProcess.once("spawn", () => {
          clearTimeout(timeout);
          resolve();
        });

        childProcess.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      this.status = "online";
      this.emit("statusChange", this.status);
      updateServerStatus(this.id, this.status, this.process.pid);

      // Start resource monitoring
      this.startResourceMonitoring();

      this.logger.info(`Server started successfully with PID ${this.process.pid}`);
    } catch (error) {
      this.status = "offline";
      this.emit("statusChange", this.status);
      updateServerStatus(this.id, this.status);
      this.logger.error(`Failed to start server: ${error}`);
      throw error;
    }
  }

  async stop(force: boolean = false): Promise<void> {
    if (this.status === "offline" || this.status === "stopping") {
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
      return;
    }

    try {
      this.logger.info(`Stopping server (force: ${force})`);

      if (force) {
        this.process.process.kill("SIGKILL");
      } else {
        this.process.process.kill("SIGTERM");

        // Wait for graceful shutdown
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            this.logger.warn("Server did not stop gracefully, forcing kill");
            if (this.process.process) {
              this.process.process.kill("SIGKILL");
            }
            resolve();
          }, 10000);

          this.process.process!.on("exit", () => {
            clearTimeout(timeout);
            resolve();
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
    } catch (error) {
      this.logger.error(`Error stopping server: ${error}`);
      throw error;
    }
  }

  async restart(): Promise<void> {
    this.logger.info("Restarting server");
    await this.stop();
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
    await this.start();
  }

  sendCommand(command: string): void {
    if (!this.process.process || this.status !== "online") {
      throw new Error(`Cannot send command: server is ${this.status}`);
    }

    if (!this.process.process.stdin) {
      throw new Error("Server process stdin is not available");
    }

    this.logger.info(`Sending command: ${command}`);
    this.process.process.stdin.write(command + "\n");

    // Log the command
    insertConsoleLog({
      serverId: this.id,
      timestamp: new Date(),
      level: "info",
      message: `> ${command}`,
    });

    this.emit("command", command);
  }

  getStatus(): ServerStatus {
    return this.status;
  }

  getProcess(): ServerProcess {
    return { ...this.process };
  }

  private handleLogOutput(message: string, defaultLevel: "info" | "error"): void {
    const lines = message.split("\n").filter((line) => line.trim());
    
    for (const line of lines) {
      let level: "info" | "warning" | "error" = defaultLevel;

      // Try to parse log level from the message
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes("error") || lowerLine.includes("exception")) {
        level = "error";
      } else if (lowerLine.includes("warn") || lowerLine.includes("warning")) {
        level = "warning";
      }

      // Parse player count from Hytale logs
      // Common patterns: "joined", "connected", "left", "disconnected", "logged in", "logged out"
      if (lowerLine.includes("joined") || lowerLine.includes("connected") || 
          lowerLine.includes("logged in") || lowerLine.match(/\bjoined\b/i)) {
        this.playerCount = Math.min(this.playerCount + 1, this.config.maxPlayers);
      } else if (lowerLine.includes("left") || lowerLine.includes("disconnected") || 
                 lowerLine.includes("logged out") || lowerLine.match(/\bleft\b/i)) {
        this.playerCount = Math.max(this.playerCount - 1, 0);
      }
      
      // Try to parse player count from status messages (e.g., "Players: 5/20")
      const playerCountMatch = line.match(/(?:players?|online):\s*(\d+)\s*(?:\/|\s+of\s+)\s*(\d+)/i);
      if (playerCountMatch) {
        const current = parseInt(playerCountMatch[1] || "0", 10);
        const max = parseInt(playerCountMatch[2] || String(this.config.maxPlayers), 10);
        this.playerCount = Math.min(current, max);
      }

      // Log to file
      if (level === "error") {
        this.logger.error(line);
      } else if (level === "warning") {
        this.logger.warn(line);
      } else {
        this.logger.info(line);
      }

      // Store in database
      insertConsoleLog({
        serverId: this.id,
        timestamp: new Date(),
        level,
        message: line,
      });

      // Emit log event
      this.emit("log", {
        id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
        timestamp: new Date(),
        level,
        message: line,
      });
    }
  }

  private handleProcessExit(code: number | null, signal: string | null): void {
    this.stopResourceMonitoring();
      this.status = "offline";
      this.playerCount = 0; // Reset player count on exit
      this.emit("statusChange", this.status);
      updateServerStatus(this.id, this.status, null);

      this.process = {
        pid: null,
        startTime: null,
        process: null,
      };

      this.emit("exit", code, signal);
  }

  private handleProcessError(error: Error): void {
    this.stopResourceMonitoring();
      this.status = "offline";
      this.playerCount = 0; // Reset player count on error
      this.emit("statusChange", this.status);
      updateServerStatus(this.id, this.status, null);
      this.emit("error", error);
  }

  private startResourceMonitoring(): void {
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
        insertServerStats({
          serverId: this.id,
          timestamp: Date.now(),
          cpu: stats.cpu,
          memory: stats.memory / 1024 / 1024, // Convert to MB
          players: this.playerCount,
          maxPlayers: this.config.maxPlayers,
        });

        // Emit stats event
        this.emit("stats", {
          cpu: stats.cpu,
          memory: stats.memory / 1024 / 1024,
          uptime,
        });
      } catch (error) {
        // Process might have exited
        if (error instanceof Error && error.message.includes("No such process")) {
          this.handleProcessExit(null, null);
        }
      }
    }, 5000); // Poll every 5 seconds
  }

  private stopResourceMonitoring(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  destroy(): void {
    this.stopResourceMonitoring();
    if (this.process.process && this.status !== "offline") {
      this.process.process.kill("SIGKILL");
    }
    this.removeAllListeners();
  }
}
