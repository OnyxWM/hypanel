import dotenv from "dotenv";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
dotenv.config();

const configSchema = z.object({
  port: z.number().int().positive().default(3000),
  wsPort: z.number().int().positive().default(3001),
  databasePath: z.string().default("./data/hypanel.db"),
  serversDir: z.string().default("./servers"),
  logsDir: z.string().default("./logs"),
  backupDir: z.string().default("./backup"),
  nodeEnv: z.enum(["development", "production"]).default("development"),
  downloaderCredentialsPath: z.string().optional(),
});

type Config = z.infer<typeof configSchema>;

export type { Config };

function loadConfig(): Config {
const rawConfig = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  wsPort: process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3001,
  databasePath: process.env.DATABASE_PATH || process.env.HYPANEL_DATABASE_PATH || "./data/hypanel.db",
  serversDir: process.env.SERVERS_DIR || process.env.HYPANEL_SERVERS_DIR || "./servers",
  logsDir: process.env.LOGS_DIR || process.env.HYPANEL_LOG_DIR || "./logs",
  backupDir: process.env.BACKUP_DIR || process.env.HYPANEL_BACKUP_DIR || (process.env.NODE_ENV === "production" ? "/home/hypanel/backup" : "./backup"),
  nodeEnv: (process.env.NODE_ENV || "development") as "development" | "production",
  downloaderCredentialsPath: process.env.HYPANEL_DOWNLOADER_CREDENTIALS_PATH,
};

  const result = configSchema.safeParse(rawConfig);
  if (!result.success) {
    throw new Error(`Invalid configuration: ${result.error.message}`);
  }

  // Resolve relative paths to absolute paths
  const config = result.data;
  return {
    ...config,
    databasePath: path.isAbsolute(config.databasePath)
      ? config.databasePath
      : path.resolve(__dirname, "..", "..", "..", config.databasePath),
    serversDir: path.isAbsolute(config.serversDir)
      ? config.serversDir
      : path.resolve(__dirname, "..", "..", "..", config.serversDir),
    logsDir: path.isAbsolute(config.logsDir)
      ? config.logsDir
      : path.resolve(__dirname, "..", "..", "..", config.logsDir),
    backupDir: path.isAbsolute(config.backupDir)
      ? config.backupDir
      : path.resolve(__dirname, "..", "..", "..", config.backupDir),
    downloaderCredentialsPath: config.downloaderCredentialsPath
      ? path.isAbsolute(config.downloaderCredentialsPath)
        ? config.downloaderCredentialsPath
        : path.resolve(__dirname, "..", "..", "..", config.downloaderCredentialsPath)
      : path.resolve(__dirname, "..", "..", "..", "data", ".hytale-downloader-credentials.json"),
  };
}

export const config = loadConfig();
