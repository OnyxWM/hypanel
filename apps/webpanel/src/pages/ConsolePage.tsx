import { useState, useEffect } from "react"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { ServerConsole } from "@/components/server-console"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { apiClient, wsClient } from "@/lib/api-client"
import type { Server, ConsoleLog } from "@/lib/api"

export default function ConsolePage() {
  const [servers, setServers] = useState<Server[]>([])
  const [selectedServer, setSelectedServer] = useState<string>("")
  const [logs, setLogs] = useState<ConsoleLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadServers()

    // Set up WebSocket for real-time updates
    wsClient.connect()

    wsClient.on("server:log", (data: any) => {
      if (data.serverId === selectedServer && data.log) {
        setLogs((prev) => [...prev, data.log])
      }
    })

    return () => {
      wsClient.disconnect()
    }
  }, [])

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
  }, [selectedServer])

  const loadServers = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await apiClient.getServers()
      setServers(data)
      if (data.length > 0 && !selectedServer) {
        setSelectedServer(data[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load servers")
      console.error("Failed to load servers:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const loadLogs = async () => {
    if (!selectedServer) return
    try {
      const data = await apiClient.getLogs(selectedServer)
      setLogs(data)
    } catch (err) {
      console.error("Failed to load logs:", err)
    }
  }

  const handleSendCommand = async (command: string) => {
    if (!selectedServer) return
    try {
      await apiClient.sendCommand(selectedServer, command)
      // Command will appear in logs via WebSocket
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send command")
    }
  }

  const server = servers.find((s) => s.id === selectedServer)

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="flex h-screen flex-col pl-64">
        <Header title="Console" subtitle="Server console output and commands" />
        <div className="flex flex-1 flex-col gap-4 p-6">
          {error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
              {error}
            </div>
          )}
          {/* Server Selector */}
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
                      : "bg-warning/20 text-warning border-warning/30"
                }
              >
                {server.status}
              </Badge>
            )}
          </div>

          {/* Console */}
          <div className="flex-1">
            <ServerConsole
              logs={logs}
              onSendCommand={handleSendCommand}
              isLoading={!server || server.status !== "online"}
            />
          </div>
        </div>
      </main>
    </div>
  )
}
