export type ServerStatus = "online" | "offline" | "starting" | "stopping" | "auth_required";
export type InstallState = "NOT_INSTALLED" | "INSTALLING" | "INSTALLED" | "FAILED";

export interface Server {
  id: string;
  name: string;
  status: ServerStatus;
  players: number;
  maxPlayers: number;
  cpu: number;
  memory: number;
  maxMemory: number;
  autostart?: boolean;
  backupEnabled?: boolean;
  aotCacheEnabled?: boolean;
  uptime: number;
  ip: string;
  port: number;
  version: string;
  createdAt: string;
  installState?: InstallState;
  lastError?: string;
  jarPath?: string;
  assetsPath?: string;
  serverRoot?: string;
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
  backupEnabled?: boolean; // Default: true
  aotCacheEnabled?: boolean; // Default: false
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

export interface PlayerInfo {
  playerName: string;
  serverId: string;
  joinTime: Date;
  lastSeen: Date;
}

export interface Player extends PlayerInfo {
  serverName: string;
}
