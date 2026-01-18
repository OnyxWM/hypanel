import { spawn } from "child_process";
import { EventEmitter } from "events";
import { logger, logInstallationPhase, logError } from "../logger/Logger.js";
import { updateServerInstallState, getServer, tryStartInstallation, getAllServers } from "../database/db.js";
import { InstallState } from "../types/index.js";
import { config } from "../config/config.js";
import path from "path";
import fs from "fs/promises";
import { createInstallationError, createFilesystemError, HypanelError } from "../errors/index.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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

       // Check if hytale-downloader exists (skip in development mode)
       if (process.env.NODE_ENV === "production") {
         const downloaderPath = await this.findDownloader();
         if (!downloaderPath) {
           const error = createInstallationError(
             "downloader_check",
             "hytale-downloader not found",
             serverId,
             "Run the install.sh script to install hytale-downloader, or install it manually and ensure it's in PATH"
           );
           logError(error, "install", serverId);
           throw error;
         }
         logInstallationPhase(serverId, "downloader_check", `Using downloader: ${downloaderPath}`, {
           downloaderPath
         });
       } else {
         logInstallationPhase(serverId, "downloader_check", "Skipping downloader check in development mode");
       }

      // Start download stage
      this.emitProgress(serverId, {
        stage: "downloading",
        progress: 10,
        message: "Downloading Hytale server files..."
       });

       // Execute hytale-downloader (or mock in development)
       const isDev = process.env.NODE_ENV !== "production";
       let downloadResult: { success: boolean; error?: string; stdout?: string; stderr?: string };

       if (isDev) {
         // In development, create mock server files for testing UI
         await this.mockInstallation(server.serverRoot, serverId);
         downloadResult = { success: true };
        } else {
          const downloaderPath = await this.findDownloader();
          if (!downloaderPath) {
            downloadResult = { success: false, error: "hytale-downloader not found" };
          } else {
            downloadResult = await this.executeDownloader(
              downloaderPath,
              server.serverRoot,
              serverId
            );
          }
        }

       if (!downloadResult.success) {
         const error = createInstallationError(
           "downloading",
           downloadResult.error || "Unknown download error",
           serverId,
           "Check network connectivity and disk space, then retry installation"
         );
         logError(error, "install", serverId);
         throw error;
       }

      // Extract ZIP file if downloader created one
      if (!isDev) {
        await this.extractDownloadedZip(server.serverRoot, serverId);
      }

      // Verify and fix file permissions for security
      await this.verifyAndFixPermissions(server.serverRoot, serverId);

      // Log directory contents after downloader completes (for debugging)
      try {
        const entries = await fs.readdir(server.serverRoot, { withFileTypes: true });
        const fileList = entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join(', ');
        logger.info(`Directory contents after download for server ${serverId}: ${fileList || '(empty)'}`);
      } catch (listError) {
        logger.warn(`Could not list directory contents for server ${serverId}: ${listError}`);
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
        // Include downloader output in error context for debugging
        const downloaderOutput = !isDev && downloadResult.stdout ? 
          `\n\nDownloader stdout:\n${downloadResult.stdout}` : '';
        const downloaderErrors = !isDev && downloadResult.stderr ? 
          `\n\nDownloader stderr:\n${downloadResult.stderr}` : '';
        
        const error = createInstallationError(
          "verification",
          `${verification.error || "Required files not found"}${downloaderOutput}${downloaderErrors}`,
          serverId,
          "Reinstall server to ensure all required files are downloaded"
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

  private async mockInstallation(serverRoot: string, serverId: string): Promise<void> {
    logger.info(`[DEV] Creating mock installation for ${serverId} at ${serverRoot}`);

    // Create mock Hytale server structure
    await fs.mkdir(serverRoot, { recursive: true });

    // Create mock HytaleServer.jar
    const jarPath = path.join(serverRoot, "HytaleServer.jar");
    await fs.writeFile(jarPath, "# Mock Hytale Server JAR - Development Only\n");

    // Create mock Assets.zip
    const assetsPath = path.join(serverRoot, "Assets.zip");
    await fs.writeFile(assetsPath, "# Mock Assets.zip - Development Only\n");

    // Create mock config.json
    const configPath = path.join(serverRoot, "config.json");
    const configContent = {
      ServerName: "Development Server",
      MOTD: "Welcome to the dev server!",
      MaxPlayers: 20,
      MaxViewRadius: 10,
      LocalCompressionEnabled: true,
      Defaults: {
        World: "world",
        GameMode: "survival"
      }
    };
    await fs.writeFile(configPath, JSON.stringify(configContent, null, 2));

    // Create mock world directory
    const worldPath = path.join(serverRoot, "worlds", "world");
    await fs.mkdir(worldPath, { recursive: true });

    // Create mock level.dat
    const levelDatPath = path.join(worldPath, "level.dat");
    await fs.writeFile(levelDatPath, "# Mock level.dat - Development Only\n");

    logger.info(`[DEV] Mock installation complete for ${serverId}`);
  }

  private async findDownloader(): Promise<string | null> {
    const commonPaths = [
      "/opt/hytale-downloader/hytale-downloader", // Bundled installation location
      "/usr/local/bin/hytale-downloader",
      "/usr/bin/hytale-downloader",
      "./hytale-downloader"
    ];

    // Check common paths first
    for (const downloadPath of commonPaths) {
      try {
        await fs.access(downloadPath, fs.constants.F_OK | fs.constants.X_OK);
        logger.info(`Found hytale-downloader at: ${downloadPath}`);
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
          logger.info("Found hytale-downloader in PATH");
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

  private async verifyAndFixPermissions(serverRoot: string, serverId: string): Promise<void> {
    logInstallationPhase(serverId, "permission_check", "Verifying and fixing file permissions");

    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      // In production, ensure proper ownership and permissions
      if (process.env.NODE_ENV === "production") {
        // Set ownership to hypanel user for all files in server root
        await execAsync(`chown -R hypanel:hypanel "${serverRoot}"`);
        
        // Set appropriate permissions: 755 for directories, 644 for files
        await execAsync(`find "${serverRoot}" -type d -exec chmod 755 {} \\;`);
        await execAsync(`find "${serverRoot}" -type f -exec chmod 644 {} \\;`);
        
        // Ensure executable files have proper permissions
        await execAsync(`find "${serverRoot}" -name "*.jar" -exec chmod 644 {} \\;`);
        
        // Verify no world-writable permissions exist
        const { stdout: worldWritable } = await execAsync(`find "${serverRoot}" -perm -o+w | head -10`);
        if (worldWritable.trim()) {
          logger.warn(`Found world-writable files in ${serverRoot}, fixing permissions`);
          await execAsync(`find "${serverRoot}" -perm -o+w -exec chmod o-w {} \\;`);
        }
        
        logger.info(`Applied secure permissions to server directory: ${serverRoot}`);
      }

      logInstallationPhase(serverId, "permission_complete", "File permissions verified and secured");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.warn(`Failed to verify permissions for ${serverRoot}: ${errorMessage}`);
      
      // Don't fail the installation for permission issues, just log warning
      logInstallationPhase(serverId, "permission_warning", `Permission verification completed with warnings: ${errorMessage}`);
    }
  }

  private async executeDownloader(
    downloaderPath: string,
    serverRoot: string,
    serverId: string
  ): Promise<{ success: boolean; error?: string; stdout?: string; stderr?: string }> {
    return new Promise((resolve) => {
      const args = [
        "-download-path", serverRoot
      ];

      // Add credentials path if configured
      if (config.downloaderCredentialsPath) {
        args.push("-credentials-path", config.downloaderCredentialsPath);
      }

      logger.info(`Executing: ${downloaderPath} ${args.join(" ")}`);

      const process = spawn(downloaderPath, args, {
        cwd: serverRoot,
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      process.stdout?.on("data", (data) => {
        stdout += data.toString();
        logger.info(`[hytale-downloader][${serverId}] ${data.toString().trim()}`);
        
        // Try to parse progress from output
        this.parseProgressFromOutput(serverId, data.toString());
      });

      process.stderr?.on("data", (data) => {
        stderr += data.toString();
        logger.info(`[hytale-downloader][${serverId}][ERROR] ${data.toString().trim()}`);
      });

      process.on("close", (code) => {
        if (code === 0) {
          logger.info(`hytale-downloader completed successfully for server ${serverId}`);
          // Log full output if verbose logging is enabled
          if (stdout.trim()) {
            logger.debug(`[hytale-downloader][${serverId}] Full stdout:\n${stdout}`);
          }
          if (stderr.trim()) {
            logger.debug(`[hytale-downloader][${serverId}] Full stderr:\n${stderr}`);
          }
          resolve({ success: true, stdout, stderr });
        } else {
          const error = stderr || stdout || `Process exited with code ${code}`;
          logger.error(`hytale-downloader failed for server ${serverId}: ${error}`);
          if (stdout.trim()) {
            logger.error(`[hytale-downloader][${serverId}] stdout:\n${stdout}`);
          }
          if (stderr.trim()) {
            logger.error(`[hytale-downloader][${serverId}] stderr:\n${stderr}`);
          }
          resolve({ success: false, error, stdout, stderr });
        }
      });

      process.on("error", (error) => {
        logger.error(`Failed to execute hytale-downloader for server ${serverId}: ${error.message}`);
        resolve({ success: false, error: error.message, stdout, stderr });
      });
    });
  }

  private async extractDownloadedZip(serverRoot: string, serverId: string): Promise<void> {
    logInstallationPhase(serverId, "extracting", "Extracting downloaded ZIP file");
    
    // The downloader creates a ZIP file at <serverRoot>.zip
    const zipPath = `${serverRoot}.zip`;
    
    try {
      // Check if ZIP file exists
      await fs.access(zipPath, fs.constants.F_OK);
      logger.info(`Found ZIP file at: ${zipPath}`);
      
      // Emit progress update
      this.emitProgress(serverId, {
        stage: "extracting",
        progress: 75,
        message: "Extracting server files..."
      });
      
      // Extract ZIP file to server root
      // Use unzip command to extract, preserving directory structure
      try {
        await execAsync(`unzip -o "${zipPath}" -d "${serverRoot}"`);
        logger.info(`Successfully extracted ZIP file for server ${serverId}`);
        
        // Remove the ZIP file after extraction
        await fs.unlink(zipPath);
        logger.debug(`Removed ZIP file: ${zipPath}`);
      } catch (extractError) {
        const errorMessage = extractError instanceof Error ? extractError.message : "Unknown extraction error";
        logger.error(`Failed to extract ZIP file for server ${serverId}: ${errorMessage}`);
        throw createInstallationError(
          "extraction",
          `Failed to extract downloaded ZIP file: ${errorMessage}`,
          serverId,
          "Check disk space and permissions, then retry installation"
        );
      }
      
      logInstallationPhase(serverId, "extraction_complete", "ZIP file extracted successfully");
    } catch (error) {
      // If ZIP file doesn't exist, check if files are already extracted
      if ((error as any).code === 'ENOENT') {
        logger.debug(`No ZIP file found at ${zipPath}, checking if files are already extracted`);
        // Continue - files might already be extracted or in a different location
        return;
      }
      throw error;
    }
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

  private async findFileRecursively(
    rootDir: string,
    filename: string,
    maxDepth: number = 3
  ): Promise<string | null> {
    async function search(currentDir: string, depth: number): Promise<string | null> {
      if (depth > maxDepth) {
        return null;
      }

      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          
          if (entry.isFile() && entry.name === filename) {
            return fullPath;
          }
          
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const found = await search(fullPath, depth + 1);
            if (found) {
              return found;
            }
          }
        }
      } catch (error) {
        // Ignore permission errors or other filesystem errors
        logger.debug(`Error searching in ${currentDir}: ${error}`);
      }
      
      return null;
    }

    return search(rootDir, 0);
  }

  private async verifyInstallation(serverRoot: string): Promise<{
    valid: boolean;
    jarPath?: string;
    assetsPath?: string;
    error?: string;
  }> {
    try {
      // First check expected location (root directory)
      let jarPath = path.join(serverRoot, "HytaleServer.jar");
      let assetsPath = path.join(serverRoot, "Assets.zip");

      let jarFound = false;
      let assetsFound = false;

      // Check for jar file in root
      try {
        await fs.access(jarPath, fs.constants.F_OK);
        jarFound = true;
        logger.debug(`Found server JAR at expected location: ${jarPath}`);
      } catch {
        // Search recursively if not found in root
        logger.debug(`HytaleServer.jar not found in root, searching recursively...`);
        const foundJar = await this.findFileRecursively(serverRoot, "HytaleServer.jar");
        if (foundJar) {
          jarPath = foundJar;
          jarFound = true;
          logger.info(`Found server JAR at: ${jarPath}`);
        }
      }

      if (!jarFound) {
        // List directory contents for debugging
        try {
          const entries = await fs.readdir(serverRoot, { withFileTypes: true });
          const fileList = entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join(', ');
          logger.warn(`Directory contents of ${serverRoot}: ${fileList || '(empty)'}`);
        } catch (listError) {
          logger.warn(`Could not list directory contents: ${listError}`);
        }
        
        return {
          valid: false,
          error: `HytaleServer.jar not found in ${serverRoot} or subdirectories (searched up to 3 levels deep)`
        };
      }

      // Check for assets file in root
      try {
        await fs.access(assetsPath, fs.constants.F_OK);
        assetsFound = true;
        logger.debug(`Found assets ZIP at expected location: ${assetsPath}`);
      } catch {
        // Search recursively if not found in root
        logger.debug(`Assets.zip not found in root, searching recursively...`);
        const foundAssets = await this.findFileRecursively(serverRoot, "Assets.zip");
        if (foundAssets) {
          assetsPath = foundAssets;
          assetsFound = true;
          logger.info(`Found assets ZIP at: ${assetsPath}`);
        }
      }

      if (!assetsFound) {
        return {
          valid: false,
          error: `Assets.zip not found in ${serverRoot} or subdirectories (searched up to 3 levels deep)`
        };
      }

      return {
        valid: true,
        jarPath: jarPath,
        assetsPath: assetsPath
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