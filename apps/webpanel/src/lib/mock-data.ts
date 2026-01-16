import type { Server } from "./api"

export const mockServers: Server[] = [
  {
    id: "1",
    name: "Creative World",
    status: "online",
    players: 12,
    maxPlayers: 50,
    cpu: 45,
    memory: 2.4,
    maxMemory: 8,
    uptime: 86400,
    ip: "192.168.1.100",
    port: 25565,
    version: "1.0.0-beta",
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "2",
    name: "Survival Server",
    status: "online",
    players: 28,
    maxPlayers: 100,
    cpu: 68,
    memory: 4.8,
    maxMemory: 12,
    uptime: 172800,
    ip: "192.168.1.101",
    port: 25566,
    version: "1.0.0-beta",
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "3",
    name: "PvP Arena",
    status: "offline",
    players: 0,
    maxPlayers: 20,
    cpu: 0,
    memory: 0,
    maxMemory: 4,
    uptime: 0,
    ip: "192.168.1.102",
    port: 25567,
    version: "0.9.0-beta",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "4",
    name: "Minigames Hub",
    status: "online",
    players: 45,
    maxPlayers: 75,
    cpu: 52,
    memory: 3.2,
    maxMemory: 8,
    uptime: 43200,
    ip: "192.168.1.103",
    port: 25568,
    version: "1.0.0-beta",
    createdAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
  },
]

const now = Date.now()
const hoursAgo = (h: number) => now - h * 60 * 60 * 1000

export const mockStats = {
  timestamps: [
    hoursAgo(12),
    hoursAgo(11),
    hoursAgo(10),
    hoursAgo(9),
    hoursAgo(8),
    hoursAgo(7),
    hoursAgo(6),
    hoursAgo(5),
    hoursAgo(4),
    hoursAgo(3),
    hoursAgo(2),
    hoursAgo(1),
    now,
  ],
  cpu: [35, 42, 38, 45, 52, 48, 55, 62, 58, 65, 70, 68, 72],
  memory: [2.1, 2.3, 2.5, 2.8, 3.1, 3.4, 3.7, 4.0, 4.2, 4.5, 4.8, 5.0, 5.2],
  players: [10, 12, 15, 18, 20, 22, 25, 28, 30, 32, 35, 38, 40],
}

import type { ConsoleLog } from "./api"

export const mockConsoleLogs: ConsoleLog[] = [
  {
    id: "1",
    timestamp: new Date(now - 300000),
    level: "info",
    message: "Server started successfully",
  },
  {
    id: "2",
    timestamp: new Date(now - 240000),
    level: "info",
    message: "Loading world data...",
  },
  {
    id: "3",
    timestamp: new Date(now - 180000),
    level: "info",
    message: "World loaded: 1,234 chunks",
  },
  {
    id: "4",
    timestamp: new Date(now - 120000),
    level: "info",
    message: "Player 'Alex' joined the game",
  },
  {
    id: "5",
    timestamp: new Date(now - 60000),
    level: "info",
    message: "Player 'Steve' joined the game",
  },
  {
    id: "6",
    timestamp: new Date(now - 30000),
    level: "warning",
    message: "High memory usage detected: 85%",
  },
]
