import type { Server, ConsoleLog } from "./api"

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
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
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
        // Only log errors if we're not intentionally disconnecting
        if (!this.isIntentionallyDisconnecting) {
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
