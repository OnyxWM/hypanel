import { spawn } from "child_process";
import { EventEmitter } from "events";
import { logger } from "../logger/Logger.js";
import { updateServerInstallState, getServer } from "../database/db.js";
import { InstallState } from "../types/index.js";
import path from "path";
import fs from "fs/promises";

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
    // Prevent concurrent installations
    if (this.activeInstallations.get(serverId)) {
      throw new Error(`Installation already in progress for server ${serverId}`);
    }

    this.activeInstallations.set(serverId, true);

    try {
      const server = getServer(serverId);
      if (!server) {
        throw new Error(`Server ${serverId} not found`);
      }

      if (!server.serverRoot) {
        throw new Error(`Server ${serverId} has no server root path`);
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
        throw new Error("hytale-downloader not found. Please ensure it is installed and in PATH.");
      }

      logger.info(`Starting installation for server ${serverId} using downloader: ${downloaderPath}`);

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
        throw new Error(`Download failed: ${downloadResult.error}`);
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
        throw new Error(`Installation verification failed: ${verification.error}`);
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
      logger.error(`Installation failed for server ${serverId}: ${errorMessage}`);

      // Update state to FAILED
      await this.updateInstallState(serverId, "FAILED", errorMessage, null, null);

      // Emit failure progress
      this.emitProgress(serverId, {
        stage: "failed",
        progress: 0,
        message: "Installation failed",
        details: { error: errorMessage }
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
}