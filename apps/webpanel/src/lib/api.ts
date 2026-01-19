export type ServerStatus = "online" | "offline" | "starting" | "stopping" | "auth_required"
export type InstallState = "NOT_INSTALLED" | "INSTALLING" | "INSTALLED" | "FAILED"
export type LogLevel = "info" | "warning" | "error"

export interface Server {
  id: string
  name: string
  status: ServerStatus
  players: number
  maxPlayers: number
  cpu: number
  memory: number
  maxMemory: number
  autostart?: boolean
  backupEnabled?: boolean
  aotCacheEnabled?: boolean
  uptime: number
  ip: string
  port: number
  version: string
  createdAt: string
  installState?: InstallState
  lastError?: string
  jarPath?: string
  assetsPath?: string
  serverRoot?: string
}

export interface ConsoleLog {
  id: string
  timestamp: Date
  level: LogLevel
  message: string
}

export interface InstallProgress {
  stage: "queued" | "downloading" | "extracting" | "verifying" | "ready" | "failed"
  progress: number // 0-100
  message: string
  details?: any
}

export interface SystemStats {
  cpu: number
  memory: number
  totalMemory: number
  freeMemory: number
  timestamp: number
}

export interface Player {
  playerName: string
  serverId: string
  serverName: string
  joinTime: string
  lastSeen: string
}

export interface ModFile {
  name: string
  size: number
  modified: string
}

export interface Notification {
  id: string
  createdAt: string
  type: string
  title: string
  message: string
  serverId?: string
  serverName?: string
}

export interface SystemActionSummary {
  requested: string[]
  succeeded: string[]
  failed: Array<{ id: string; error: string }>
}

export interface JournalEntry {
  cursor: string
  timestamp: Date
  level: LogLevel
  message: string
}

export interface SystemJournalResponse {
  entries: JournalEntry[]
  nextCursor?: string
}

export interface UpdateCheckResponse {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseUrl?: string
  releaseNotes?: string
  rateLimitRemaining?: number
  rateLimitReset?: number
  error?: string
}

export interface VersionResponse {
  version: string
}
