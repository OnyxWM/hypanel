import { useState, useEffect, useCallback, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { Sidebar } from "@/components/sidebar"
import { ServerConsole } from "@/components/server-console"
import { AuthGuidance } from "@/components/auth-guidance"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { apiClient, wsClient } from "@/lib/api-client"
import type { Server, ConsoleLog } from "@/lib/api"

export default function ConsolePage() {
  const [searchParams] = useSearchParams()
  const [servers, setServers] = useState<Server[]>([])
  const [selectedServer, setSelectedServer] = useState<string>("")
  const [logs, setLogs] = useState<ConsoleLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const logsRef = useRef(logs)
  
  logsRef.current = logs

  const requestedServerId = searchParams.get("serverId") || ""

  const loadServers = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await apiClient.getServers()
      setServers(data)
      const requestedExists = requestedServerId && data.some((s) => s.id === requestedServerId)
      if (requestedExists) {
        setSelectedServer(requestedServerId)
      } else if (data.length > 0 && !selectedServer) {
        setSelectedServer(data[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load servers")
      console.error("Failed to load servers:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const loadLogs = useCallback(async () => {
    if (!selectedServer) return
    try {
      const data = await apiClient.getLogs(selectedServer)
      setLogs(data)
    } catch (err) {
      console.error("Failed to load logs:", err)
    }
  }, [selectedServer])

  const handleLog = useCallback((data: any) => {
    if (data.serverId === selectedServer && data.log) {
      // Convert timestamp string to Date object if needed (WebSocket sends JSON)
      const log = {
        ...data.log,
        timestamp: typeof data.log.timestamp === "string" 
          ? new Date(data.log.timestamp) 
          : data.log.timestamp instanceof Date 
            ? data.log.timestamp 
            : new Date(data.log.timestamp)
      }
      setLogs((prev) => [...prev, log])
    }
  }, [selectedServer])

  const handleStatusChange = useCallback((data: any) => {
    setServers((prev) => 
      prev.map((s) => 
        s.id === data.serverId 
          ? { ...s, status: data.status } 
          : s
      )
    )
  }, [])

  useEffect(() => {
    loadServers()

    wsClient.connect()
    wsClient.on("server:log", handleLog)
    wsClient.on("server:status", handleStatusChange)

    return () => {
      wsClient.off("server:log", handleLog)
      wsClient.off("server:status", handleStatusChange)
      wsClient.disconnect()
    }
  }, [handleLog, handleStatusChange])

  useEffect(() => {
    if (!requestedServerId) return
    if (requestedServerId === selectedServer) return
    if (!servers.some((s) => s.id === requestedServerId)) return
    setSelectedServer(requestedServerId)
  }, [requestedServerId, selectedServer, servers])

  useEffect(() => {
    if (selectedServer) {
      loadLogs()
      wsClient.subscribe(selectedServer)
    } else {
      wsClient.unsubscribe()
      setLogs([])
    }

    return () => {
      if (selectedServer) {
        wsClient.unsubscribe()
      }
    }
  }, [selectedServer, loadLogs])

  const handleSendCommand = async (command: string) => {
    if (!selectedServer) return
    try {
      await apiClient.sendCommand(selectedServer, command)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send command")
    }
  }

  const server = servers.find((s) => s.id === selectedServer)

  return (
    <div className="h-screen bg-background overflow-hidden">
      <Sidebar />
      <main className="flex h-screen flex-col pl-64">
        <div className="flex flex-col h-full">
          {/* Header and Controls */}
          <div className="flex-shrink-0 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="px-6 py-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h1 className="text-2xl font-semibold">Console</h1>
                  <p className="text-sm text-muted-foreground">Server console output and commands</p>
                </div>
              </div>
              {error && (
                <div className="mb-3 rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
                  {error}
                </div>
              )}
              <div className="flex items-center gap-4">
                <Select value={selectedServer} onValueChange={setSelectedServer} disabled={isLoading}>
                  <SelectTrigger className="w-[250px]">
                    <SelectValue placeholder={isLoading ? "Loading servers..." : "Select server"} />
                  </SelectTrigger>
                  <SelectContent>
                    {servers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              s.status === "online"
                                ? "bg-success"
                                : s.status === "offline"
                                  ? "bg-muted-foreground"
                                  : s.status === "auth_required"
                                    ? "bg-destructive animate-pulse"
                                    : "bg-warning"
                            }`}
                          />
                          {s.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {server && (
                  <Badge
                    variant="outline"
                    className={
                      server.status === "online"
                        ? "bg-success/20 text-success border-success/30"
                        : server.status === "offline"
                          ? "bg-muted text-muted-foreground"
                          : server.status === "auth_required"
                            ? "bg-destructive/20 text-destructive border-destructive/30"
                            : "bg-warning/20 text-warning border-warning/30"
                    }
                  >
                    {server.status}
                  </Badge>
                )}
              </div>
              {server && server.status === "auth_required" && (
                <div className="mt-3">
                  <AuthGuidance serverId={server.id} />
                </div>
              )}
            </div>
          </div>
          
          {/* Console - Takes remaining space */}
          <div className="flex-1 min-h-0 px-6 py-4">
            <ServerConsole
              logs={logs}
              onSendCommand={handleSendCommand}
              isLoading={!server || server.status === "starting" || server.status === "stopping"}
            />
          </div>
        </div>
      </main>
    </div>
  )
}
