import { spawn } from "child_process";
import { EventEmitter } from "events";
import { logger, logInstallationPhase, logError } from "../logger/Logger.js";
import { updateServerInstallState, getServer, tryStartInstallation, getAllServers } from "../database/db.js";
import { InstallState } from "../types/index.js";
import path from "path";
import fs from "fs/promises";
import { createInstallationError, createFilesystemError, HypanelError } from "../errors/index.js";

export type InstallProgress = {
  stage: "queued" | "downloading" | "extracting" | "verifying" | "ready" | "failed";
  progress: number; // 0-100
  message: string;
  details?: any;
};

export class Installer extends EventEmitter {
  private activeInstallations: Map<string, boolean> = new Map();

  constructor() {
    super();
  }

  async installServer(serverId: string): Promise<void> {
    logInstallationPhase(serverId, "init", "Starting installation process");

    // Use database-based locking to prevent concurrent installations
    const lockResult = tryStartInstallation(serverId);
    if (!lockResult.success) {
      const error = createInstallationError(
        "locking",
        lockResult.reason || "Failed to acquire installation lock",
        serverId,
        "Check if another installation is already running for this server"
      );
      logError(error, "install", serverId);
      throw error;
    }

    this.activeInstallations.set(serverId, true);

    try {
      const server = getServer(serverId);
      if (!server) {
        const error = createInstallationError("validation", "Server not found in database", serverId);
        logError(error, "install", serverId);
        throw error;
      }

      if (!server.serverRoot) {
        const error = createInstallationError("validation", "Server has no server root path configured", serverId);
        logError(error, "install", serverId);
        throw error;
      }

      // If this is a retry (from FAILED state), clean up any partial installation
      const originalState = server.installState;
      if (originalState === "FAILED") {
        await this.cleanupInstallation(serverId, server.serverRoot);
        this.emitProgress(serverId, {
          stage: "queued",
          progress: 0,
          message: "Cleaning up previous installation attempt..."
        });
      }

      // Update state to INSTALLING
      await this.updateInstallState(serverId, "INSTALLING", null, null, null);
      this.emitProgress(serverId, {
        stage: "queued",
        progress: 0,
        message: "Installation queued"
      });

      // Check if hytale-downloader exists
      const downloaderPath = await this.findDownloader();
      if (!downloaderPath) {
        const error = createInstallationError(
          "downloader_check",
          "hytale-downloader not found",
          serverId,
          "Install hytale-downloader and ensure it's in PATH, or run the system installer"
        );
        logError(error, "install", serverId);
        throw error;
      }

      logInstallationPhase(serverId, "downloader_check", `Using downloader: ${downloaderPath}`, {
        downloaderPath
      });

      // Start download stage
      this.emitProgress(serverId, {
        stage: "downloading",
        progress: 10,
        message: "Downloading Hytale server files..."
      });

      // Execute hytale-downloader
      const downloadResult = await this.executeDownloader(
        downloaderPath,
        server.serverRoot,
        serverId
      );

      if (!downloadResult.success) {
        const error = createInstallationError(
          "downloading",
          downloadResult.error || "Unknown download error",
          serverId,
          "Check network connectivity and disk space, then retry the installation"
        );
        logError(error, "install", serverId);
        throw error;
      }

      // Start verification stage
      this.emitProgress(serverId, {
        stage: "verifying",
        progress: 80,
        message: "Verifying downloaded files..."
      });

      // Verify required files exist
      const verification = await this.verifyInstallation(server.serverRoot);
      if (!verification.valid) {
        const error = createInstallationError(
          "verification",
          verification.error || "Required files not found",
          serverId,
          "Reinstall the server to ensure all required files are downloaded"
        );
        logError(error, "install", serverId);
        throw error;
      }

      // Update database with paths
      await this.updateInstallState(
        serverId,
        "INSTALLED",
        undefined,
        verification.jarPath!,
        verification.assetsPath!
      );

      // Installation complete
      this.emitProgress(serverId, {
        stage: "ready",
        progress: 100,
        message: "Installation completed successfully",
        details: {
          jarPath: verification.jarPath,
          assetsPath: verification.assetsPath
        }
      });

      logger.info(`Successfully installed server ${serverId}`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Log the structured error if it's a HypanelError, otherwise create a generic one
      if (error instanceof HypanelError) {
        logError(error, "install", serverId, error.context);
      } else {
        const genericError = createInstallationError("unknown", errorMessage, serverId);
        logError(genericError, "install", serverId);
      }

      // Update state to FAILED
      await this.updateInstallState(serverId, "FAILED", errorMessage, null, null);

      // Emit failure progress
      this.emitProgress(serverId, {
        stage: "failed",
        progress: 0,
        message: "Installation failed",
        details: { 
          error: errorMessage,
          suggestedAction: error instanceof HypanelError ? error.suggestedAction : "Check logs for details"
        }
      });

      throw error;
    } finally {
      this.activeInstallations.delete(serverId);
    }
  }

  private async findDownloader(): Promise<string | null> {
    const commonPaths = [
      "/usr/local/bin/hytale-downloader",
      "/usr/bin/hytale-downloader",
      "/opt/hytale-downloader/bin/hytale-downloader",
      "./hytale-downloader"
    ];

    // Check common paths first
    for (const downloadPath of commonPaths) {
      try {
        await fs.access(downloadPath, fs.constants.F_OK | fs.constants.X_OK);
        return downloadPath;
      } catch {
        // Continue checking
      }
    }

    // Check PATH
    return new Promise((resolve) => {
      const which = spawn("which", ["hytale-downloader"]);
      
      which.on("close", (code) => {
        if (code === 0) {
          resolve("hytale-downloader");
        } else {
          resolve(null);
        }
      });

      which.on("error", () => {
        resolve(null);
      });
    });
  }

  private async executeDownloader(
    downloaderPath: string,
    serverRoot: string,
    serverId: string
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const args = [
        "--output", serverRoot,
        "--server-only" // Only download server files
      ];

      logger.info(`Executing: ${downloaderPath} ${args.join(" ")}`);

      const process = spawn(downloaderPath, args, {
        cwd: serverRoot,
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      process.stdout?.on("data", (data) => {
        stdout += data.toString();
        logger.debug(`[hytale-downloader][${serverId}] ${data.toString().trim()}`);
        
        // Try to parse progress from output
        this.parseProgressFromOutput(serverId, data.toString());
      });

      process.stderr?.on("data", (data) => {
        stderr += data.toString();
        logger.debug(`[hytale-downloader][${serverId}][ERROR] ${data.toString().trim()}`);
      });

      process.on("close", (code) => {
        if (code === 0) {
          logger.info(`hytale-downloader completed successfully for server ${serverId}`);
          resolve({ success: true });
        } else {
          const error = stderr || stdout || `Process exited with code ${code}`;
          logger.error(`hytale-downloader failed for server ${serverId}: ${error}`);
          resolve({ success: false, error });
        }
      });

      process.on("error", (error) => {
        logger.error(`Failed to execute hytale-downloader for server ${serverId}: ${error.message}`);
        resolve({ success: false, error: error.message });
      });
    });
  }

  private parseProgressFromOutput(serverId: string, output: string): void {
    // Common progress patterns from downloaders
    const patterns = [
      /(\d+)%/,
      /progress[:\s]+(\d+)%?/i,
      /downloaded[:\s]+(\d+)%?/i,
      /(\d+)\s*\/\s*(\d+)/, // fraction format like "150 / 200"
    ];

    const lines = output.split("\n");
    for (const line of lines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          let progress = 0;
          
          if (pattern === patterns[3]) {
            // Fraction pattern
            const current = parseInt(match[1] || "0");
            const total = parseInt(match[2] || "1");
            progress = total > 0 ? Math.round((current / total) * 100) : 0;
          } else {
            // Percentage pattern
            progress = parseInt(match[1] || "0");
          }

          // Clamp progress to download stage range (10-70%)
          const clampedProgress = Math.max(10, Math.min(70, 10 + Math.floor(progress * 0.6)));

          this.emitProgress(serverId, {
            stage: "downloading",
            progress: clampedProgress,
            message: `Downloading... ${progress}%`
          });

          return;
        }
      }
    }
  }

  private async verifyInstallation(serverRoot: string): Promise<{
    valid: boolean;
    jarPath?: string;
    assetsPath?: string;
    error?: string;
  }> {
    try {
      const expectedJar = path.join(serverRoot, "HytaleServer.jar");
      const expectedAssets = path.join(serverRoot, "Assets.zip");

      // Check for jar file
      try {
        await fs.access(expectedJar, fs.constants.F_OK);
        logger.debug(`Found server JAR: ${expectedJar}`);
      } catch {
        return {
          valid: false,
          error: `HytaleServer.jar not found at ${expectedJar}`
        };
      }

      // Check for assets file
      try {
        await fs.access(expectedAssets, fs.constants.F_OK);
        logger.debug(`Found assets ZIP: ${expectedAssets}`);
      } catch {
        return {
          valid: false,
          error: `Assets.zip not found at ${expectedAssets}`
        };
      }

      return {
        valid: true,
        jarPath: expectedJar,
        assetsPath: expectedAssets
      };

    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Unknown verification error"
      };
    }
  }

  private async updateInstallState(
    serverId: string,
    state: InstallState,
    error?: string | null,
    jarPath?: string | null,
    assetsPath?: string | null
  ): Promise<void> {
    try {
      updateServerInstallState(serverId, state, error || null, jarPath || null, assetsPath || null);
      logger.debug(`Updated install state for server ${serverId} to ${state}`);
    } catch (dbError) {
      logger.error(`Failed to update install state for server ${serverId}: ${dbError}`);
    }
  }

  private emitProgress(serverId: string, progress: InstallProgress): void {
    this.emit("installProgress", serverId, progress);
    logger.debug(`Install progress for ${serverId}: ${progress.stage} (${progress.progress}%) - ${progress.message}`);
  }

  isInstalling(serverId: string): boolean {
    return this.activeInstallations.get(serverId) || false;
  }

  getActiveInstallations(): string[] {
    return Array.from(this.activeInstallations.keys());
  }

  async recoverInterruptedInstallations(): Promise<void> {
    // This should be called during daemon startup to handle crashed installations
    logger.info("Checking for interrupted installations...");
    
    try {
      const servers = getAllServers();
      const interruptedServers = servers.filter(server => server.installState === "INSTALLING");
      
      if (interruptedServers.length > 0) {
        logger.warn(`Found ${interruptedServers.length} interrupted installations, marking as FAILED`);
        
        for (const server of interruptedServers) {
          await this.updateInstallState(
            server.id,
            "FAILED",
            "Installation was interrupted due to daemon restart. Please retry the installation.",
            null,
            null
          );
          
          this.emitProgress(server.id, {
            stage: "failed",
            progress: 0,
            message: "Installation interrupted - daemon restarted",
            details: { 
              error: "Installation was interrupted due to daemon restart. Please retry the installation.",
              recoverable: true
            }
          });
        }
      } else {
        logger.info("No interrupted installations found");
      }
    } catch (error) {
      logger.error(`Error during installation recovery: ${error}`);
    }
  }

  private async cleanupInstallation(serverId: string, serverRoot: string): Promise<void> {
    // Clean up any partial installation artifacts to ensure a clean reinstallation
    logger.info(`Cleaning up installation artifacts for server ${serverId}`);
    
    try {
      // List of files/directories that might exist from a partial installation
      const cleanupTargets = [
        "HytaleServer.jar",
        "Assets.zip",
        "temp", // Temporary download directory
        ".download" // Download metadata
      ];
      
      for (const target of cleanupTargets) {
        const targetPath = path.join(serverRoot, target);
        try {
          const stats = await fs.stat(targetPath);
          if (stats.isDirectory()) {
            await fs.rm(targetPath, { recursive: true, force: true });
            logger.debug(`Removed directory: ${targetPath}`);
          } else {
            await fs.unlink(targetPath);
            logger.debug(`Removed file: ${targetPath}`);
          }
        } catch (error) {
          // Ignore errors if file/directory doesn't exist
          if ((error as any).code !== 'ENOENT') {
            logger.warn(`Failed to remove ${targetPath}: ${error}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Error during cleanup for server ${serverId}: ${error}`);
      // Don't throw error here, as cleanup failures shouldn't prevent retry
    }
  }
}