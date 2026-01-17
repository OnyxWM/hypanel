export type ServerStatus = "online" | "offline" | "starting" | "stopping"
export type InstallState = "NOT_INSTALLED" | "INSTALLING" | "INSTALLED" | "FAILED"

export interface Server {
  id: string
  name: string
  status: ServerStatus
  players: number
  maxPlayers: number
  cpu: number
  memory: number
  maxMemory: number
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
  level: "info" | "warning" | "error"
  message: string
}

export interface InstallProgress {
  stage: "queued" | "downloading" | "extracting" | "verifying" | "ready" | "failed"
  progress: number // 0-100
  message: string
  details?: any
}
