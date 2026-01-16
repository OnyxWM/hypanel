export type ServerStatus = "online" | "offline" | "starting" | "stopping"

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
}

export interface ConsoleLog {
  id: string
  timestamp: Date
  level: "info" | "warning" | "error"
  message: string
}
