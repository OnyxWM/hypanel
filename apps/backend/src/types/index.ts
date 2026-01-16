export type ServerStatus = "online" | "offline" | "starting" | "stopping";

export interface Server {
  id: string;
  name: string;
  status: ServerStatus;
  players: number;
  maxPlayers: number;
  cpu: number;
  memory: number;
  maxMemory: number;
  uptime: number;
  ip: string;
  port: number;
  version: string;
  createdAt: string;
}

export interface ConsoleLog {
  id: string;
  timestamp: Date;
  level: "info" | "warning" | "error";
  message: string;
}

// Internal types
export interface ServerConfig {
  id: string;
  name: string;
  path: string;
  executable: string;
  jarFile?: string; // For Hytale: "HytaleServer.jar"
  assetsPath?: string; // For Hytale: Path to Assets.zip
  args: string[];
  env: Record<string, string>;
  ip: string;
  port: number;
  maxMemory: number;
  maxPlayers: number;
  version?: string;
  // Hytale-specific authentication
  sessionToken?: string;
  identityToken?: string;
  bindAddress?: string; // Default: "0.0.0.0"
}

export interface ServerStats {
  serverId: string;
  timestamp: number;
  cpu: number;
  memory: number;
  players: number;
  maxPlayers: number;
}

export interface ServerProcess {
  pid: number | null;
  startTime: number | null;
  process: import("child_process").ChildProcess | null;
}
