import type {
  Server,
  ConsoleLog,
  SystemStats,
  ModFile,
  Notification,
  SystemActionSummary,
  SystemJournalResponse,
} from "./api"

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000"
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001"

// API Client
export class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const isFormDataBody = typeof FormData !== "undefined" && options.body instanceof FormData
    const response = await fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        ...(isFormDataBody ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || error.message || `HTTP ${response.status}`)
    }

    // Handle 204 No Content responses (no body)
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T
    }

    // Check if response has content before parsing JSON
    const contentType = response.headers.get("content-type")
    if (contentType && contentType.includes("application/json")) {
      return response.json()
    }

    // If no JSON content, return undefined for void responses
    return undefined as T
  }

  // Web UI authentication
  async login(input: { username?: string; password: string }): Promise<{ ok: boolean; user: { username: string } }> {
    return this.request<{ ok: boolean; user: { username: string } }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: input.username ?? "hypanel", password: input.password }),
    })
  }

  async logout(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>("/api/auth/logout", { method: "POST" })
  }

  async me(): Promise<{ authenticated: boolean; user: { username: string } }> {
    return this.request<{ authenticated: boolean; user: { username: string } }>("/api/auth/me")
  }

  // Server operations
  async getServers(): Promise<Server[]> {
    return this.request<Server[]>("/api/servers")
  }

  async getServer(id: string): Promise<Server> {
    return this.request<Server>(`/api/servers/${id}`)
  }

  async createServer(data: {
    name: string
    path: string
    executable?: string
    jarFile?: string
    assetsPath?: string
    args?: string[]
    env?: Record<string, string>
    ip?: string
    port?: number
    maxMemory: number
    maxPlayers: number
    version?: string
    sessionToken?: string
    identityToken?: string
    bindAddress?: string
    backupEnabled?: boolean
    aotCacheEnabled?: boolean
  }): Promise<Server> {
    return this.request<Server>("/api/servers", {
      method: "POST",
      body: JSON.stringify(data),
    })
  }

  async deleteServer(id: string): Promise<void> {
    await this.request(`/api/servers/${id}`, {
      method: "DELETE",
    })
  }

  async updateServer(
    id: string,
    data: Partial<{
      name: string
      ip: string
      port: number
      maxMemory: number
      maxPlayers: number
      autostart?: boolean
      version?: string
      args: string[]
      env: Record<string, string>
      sessionToken?: string
      identityToken?: string
      bindAddress?: string
      backupEnabled?: boolean
      aotCacheEnabled?: boolean
    }>
  ): Promise<Server> {
    return this.request<Server>(`/api/servers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  }

  async startServer(id: string): Promise<Server> {
    return this.request<Server>(`/api/servers/${id}/start`, {
      method: "POST",
    })
  }

  async stopServer(id: string, force: boolean = false): Promise<Server> {
    return this.request<Server>(`/api/servers/${id}/stop?force=${force}`, {
      method: "POST",
    })
  }

  async restartServer(id: string): Promise<Server> {
    return this.request<Server>(`/api/servers/${id}/restart`, {
      method: "POST",
    })
  }

  async sendCommand(id: string, command: string): Promise<void> {
    await this.request(`/api/servers/${id}/command`, {
      method: "POST",
      body: JSON.stringify({ command }),
    })
  }

  async getLogs(id: string, limit: number = 1000): Promise<ConsoleLog[]> {
    const logs = await this.request<ConsoleLog[]>(`/api/servers/${id}/logs?limit=${limit}`)
    return logs.map((log) => ({
      ...log,
      timestamp: typeof log.timestamp === "string" ? new Date(log.timestamp) : log.timestamp,
    }))
  }

  async getStats(id: string, limit: number = 100): Promise<any[]> {
    return this.request<any[]>(`/api/servers/${id}/stats?limit=${limit}`)
  }

  async installServer(id: string): Promise<void> {
    await this.request(`/api/servers/${id}/install`, {
      method: "POST",
    })
  }

  async getServerConfig(id: string): Promise<any> {
    return this.request<any>(`/api/servers/${id}/config`)
  }

  async updateServerConfig(id: string, config: any): Promise<any> {
    return this.request<any>(`/api/servers/${id}/config`, {
      method: "PUT",
      body: JSON.stringify(config),
    })
  }

  async getWorlds(id: string): Promise<string[]> {
    return this.request<string[]>(`/api/servers/${id}/worlds`)
  }

  async getServerMods(serverId: string): Promise<ModFile[]> {
    return this.request<ModFile[]>(`/api/servers/${serverId}/mods`)
  }

  async uploadServerMod(serverId: string, file: File): Promise<ModFile[]> {
    const form = new FormData()
    form.append("file", file)
    return this.request<ModFile[]>(`/api/servers/${serverId}/mods/upload`, {
      method: "POST",
      body: form,
    })
  }

  async deleteServerMod(serverId: string, filename: string): Promise<ModFile[]> {
    return this.request<ModFile[]>(
      `/api/servers/${serverId}/mods/${encodeURIComponent(filename)}`,
      {
        method: "DELETE",
      }
    )
  }

  async getWorldConfig(id: string, world: string): Promise<any> {
    return this.request<any>(`/api/servers/${id}/worlds/${world}/config`)
  }

  async updateWorldConfig(id: string, world: string, config: any): Promise<any> {
    return this.request<any>(`/api/servers/${id}/worlds/${world}/config`, {
      method: "PUT",
      body: JSON.stringify(config),
    })
  }

  async startDownloaderAuth(): Promise<{ url: string; code: string }> {
    return this.request<{ url: string; code: string }>("/api/downloader/auth/start", {
      method: "POST",
    })
  }

  async getDownloaderAuthStatus(): Promise<{ authenticated: boolean; status: string; code?: string; stdout?: string; stderr?: string }> {
    return this.request<{ authenticated: boolean; status: string; code?: string; stdout?: string; stderr?: string }>("/api/downloader/auth/status")
  }

  async completeDownloaderAuth(): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("/api/downloader/auth/complete", {
      method: "POST",
    })
  }

  async cancelDownloaderAuth(): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("/api/downloader/auth/cancel", {
      method: "POST",
    })
  }

  async getSystemStats(): Promise<SystemStats> {
    return this.request<SystemStats>("/api/system/stats")
  }

  async stopAllServers(force: boolean = false): Promise<SystemActionSummary> {
    return this.request<SystemActionSummary>(`/api/system/servers/stop-all?force=${force}`, {
      method: "POST",
    })
  }

  async restartOnlineServers(): Promise<SystemActionSummary> {
    return this.request<SystemActionSummary>("/api/system/servers/restart-online", {
      method: "POST",
    })
  }

  async restartDaemon(): Promise<{ queued: boolean; service?: string }> {
    return this.request<{ queued: boolean; service?: string }>("/api/system/daemon/restart", {
      method: "POST",
    })
  }

  async getSystemJournal(input: { limit?: number; cursor?: string } = {}): Promise<SystemJournalResponse> {
    const limit = typeof input.limit === "number" ? input.limit : 200
    const cursor = input.cursor
    const qs = new URLSearchParams()
    qs.set("limit", String(limit))
    if (cursor) qs.set("cursor", cursor)
    const res = await this.request<SystemJournalResponse>(`/api/system/journal?${qs.toString()}`)
    return {
      ...res,
      entries: (res.entries || []).map((e: any) => ({
        ...e,
        timestamp:
          typeof e.timestamp === "string"
            ? new Date(e.timestamp)
            : typeof e.timestamp === "number"
              ? new Date(e.timestamp)
              : e.timestamp instanceof Date
                ? e.timestamp
                : new Date(e.timestamp),
      })),
    }
  }

  async getNotifications(limit: number = 50): Promise<Notification[]> {
    return this.request<Notification[]>(`/api/notifications?limit=${limit}`)
  }

  async clearNotifications(): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/notifications`, {
      method: "DELETE",
    })
  }

  async getBackups(): Promise<Array<{ 
    serverId: string
    serverName: string
    backups: Array<{ name: string; path: string; size: number; modified: string; isDirectory: boolean }>
  }>> {
    return this.request<Array<{ 
      serverId: string
      serverName: string
      backups: Array<{ name: string; path: string; size: number; modified: string; isDirectory: boolean }>
    }>>("/api/servers/backups")
  }

  async deleteBackup(serverId: string, backupName: string): Promise<void> {
    await this.request(`/api/servers/backups/${encodeURIComponent(serverId)}/${encodeURIComponent(backupName)}`, {
      method: "DELETE",
    })
  }

  async getAllPlayers(): Promise<Array<{ playerName: string; serverId: string; serverName: string; joinTime: string; lastSeen: string }>> {
    return this.request<Array<{ playerName: string; serverId: string; serverName: string; joinTime: string; lastSeen: string }>>("/api/players")
  }

  async getServerPlayers(serverId: string): Promise<Array<{ playerName: string; serverId: string; serverName: string; joinTime: string; lastSeen: string }>> {
    return this.request<Array<{ playerName: string; serverId: string; serverName: string; joinTime: string; lastSeen: string }>>(`/api/servers/${serverId}/players`)
  }

  async refreshServerPlayers(serverId: string): Promise<{ success: boolean; message: string; players: number; playerNames: string[] }> {
    return this.request<{ success: boolean; message: string; players: number; playerNames: string[] }>(`/api/servers/${serverId}/refresh-players`, {
      method: "POST",
    })
  }
}

export const apiClient = new ApiClient()

// WebSocket Client
export class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 1000
  private listeners: Map<string, Set<(data: any) => void>> = new Map()
  private serverId: string | null = null
  private isIntentionallyDisconnecting = false

  constructor(url: string = WS_URL) {
    this.url = url
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    try {
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        console.log("WebSocket connected")
        this.reconnectAttempts = 0
        if (this.serverId) {
          this.subscribe(this.serverId)
        }
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          this.handleMessage(data)
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error)
        }
      }

      this.ws.onerror = (error) => {
        // Only log errors if we're not intentionally disconnecting and not in rapid reconnection
        if (!this.isIntentionallyDisconnecting && this.reconnectAttempts === 0) {
          console.error("WebSocket error:", error)
        }
      }

      this.ws.onclose = () => {
        console.log("WebSocket disconnected")
        // Only attempt reconnect if we didn't intentionally disconnect
        if (!this.isIntentionallyDisconnecting) {
          this.attemptReconnect()
        }
        this.isIntentionallyDisconnecting = false
      }
    } catch (error) {
      console.error("Failed to create WebSocket:", error)
      this.attemptReconnect()
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnection attempts reached")
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    setTimeout(() => {
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`)
      this.connect()
    }, delay)
  }

  subscribe(serverId: string): void {
    this.serverId = serverId
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "subscribe", serverId }))
    }
  }

  unsubscribe(): void {
    this.serverId = null
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "unsubscribe" }))
    }
  }

  sendCommand(command: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "command:send", command }))
    }
  }

  private handleMessage(data: any): void {
    const { type } = data
    const listeners = this.listeners.get(type)
    if (listeners) {
      listeners.forEach((listener) => listener(data))
    }
  }

  on(event: string, callback: (data: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
  }

  off(event: string, callback: (data: any) => void): void {
    const listeners = this.listeners.get(event)
    if (listeners) {
      listeners.delete(callback)
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.isIntentionallyDisconnecting = true
      this.unsubscribe()
      
      // Only close if WebSocket is in a state where it can be closed
      // WebSocket.CONNECTING = 0, WebSocket.OPEN = 1, WebSocket.CLOSING = 2, WebSocket.CLOSED = 3
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        try {
          this.ws.close()
        } catch (error) {
          // Ignore errors when closing WebSocket
          console.warn("Error closing WebSocket:", error)
        }
      }
      this.ws = null
    }
    this.listeners.clear()
  }
}

export const wsClient = new WebSocketClient()
