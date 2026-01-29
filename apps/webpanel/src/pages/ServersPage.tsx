import { useState, useEffect } from "react"
import { Filter, Grid3X3, List } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { ServerCard } from "@/components/server-card"
import { CreateServerDialog } from "@/components/create-server-dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiClient, wsClient } from "@/lib/api-client"
import type { Server } from "@/lib/api"

export default function ServersPage() {
  const [servers, setServers] = useState<Server[]>([])
  const [filter, setFilter] = useState<string>("all")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState<Record<string, any>>({})

  useEffect(() => {
    loadServers()
    
    // Set up WebSocket for real-time updates
    wsClient.connect()
    wsClient.on("server:status", (data: any) => {
      setServers((prev) =>
        prev.map((s) => (s.id === data.serverId ? { ...s, status: data.status } : s))
      )
    })
    wsClient.on("server:stats", (data: any) => {
      setServers((prev) =>
        prev.map((s) => {
          if (s.id === data.serverId) {
            return {
              ...s,
              cpu: data.stats.cpu || s.cpu,
              memory: data.stats.memory || s.memory,
              uptime: data.stats.uptime || s.uptime,
            }
          }
          return s
        })
      )
    })
    wsClient.on("server:install:progress", (data: any) => {
      setInstallProgress((prev) => ({
        ...prev,
        [data.serverId]: data.progress
      }))
      setServers((prev) =>
        prev.map((s) => {
          if (s.id === data.serverId && data.progress) {
            return {
              ...s,
              installState: data.progress.stage === "ready" ? "INSTALLED" : 
                           data.progress.stage === "failed" ? "FAILED" : "INSTALLING",
              lastError: data.progress.stage === "failed" ? data.progress.message : undefined
            }
          }
          return s
        })
      )
    })

    return () => {
      wsClient.disconnect()
    }
  }, [])

  const loadServers = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await apiClient.getServers()
      setServers(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load servers")
      console.error("Failed to load servers:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const filteredServers = servers.filter((server) => {
    if (filter === "all") return true
    return server.status === filter
  })

  const handleStartServer = async (id: string) => {
    try {
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, status: "starting" as const } : s)))
      const updated = await apiClient.startServer(id)
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start server")
      await loadServers()
    }
  }

  const handleStopServer = async (id: string) => {
    try {
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, status: "stopping" as const } : s)))
      const updated = await apiClient.stopServer(id)
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop server")
      await loadServers()
    }
  }

  const handleRestartServer = async (id: string) => {
    try {
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, status: "starting" as const } : s)))
      const updated = await apiClient.restartServer(id)
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restart server")
      await loadServers()
    }
  }

  const handleDeleteServer = async (id: string) => {
    try {
      await apiClient.deleteServer(id)
      setServers((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete server")
      await loadServers()
    }
  }

  const handleInstallServer = async (id: string) => {
    try {
      setServers((prev) => 
        prev.map((s) => (s.id === id ? { ...s, installState: "INSTALLING", lastError: undefined } : s))
      )
      await apiClient.installServer(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start installation")
      setServers((prev) => 
        prev.map((s) => (s.id === id ? { ...s, installState: "FAILED", lastError: err instanceof Error ? err.message : "Installation failed" } : s))
      )
    }
  }

  const handleCreateServer = async (data: {
    name: string
    maxMemory: number
    port?: number
    backupEnabled?: boolean
    backupFrequency?: number
    backupMaxCount?: number
    aotCacheEnabled?: boolean
    acceptEarlyPlugins?: boolean
  }) => {
    const serverPath = `hytale/${data.name.toLowerCase().replace(/\s+/g, "-")}`;
    try {
      const newServer = await apiClient.createServer({
        name: data.name,
        path: serverPath,
        executable: "java",
        assetsPath: `hytale/${data.name.toLowerCase().replace(/\s+/g, "-")}/Assets.zip`,
        port: data.port || 5520,
        maxPlayers: 20,
        maxMemory: data.maxMemory * 1024,
        bindAddress: "0.0.0.0",
        ip: "0.0.0.0",
        backupEnabled: data.backupEnabled,
        backupFrequency: data.backupFrequency,
        backupMaxCount: data.backupMaxCount,
        aotCacheEnabled: data.aotCacheEnabled,
        acceptEarlyPlugins: data.acceptEarlyPlugins,
      })
      setServers((prev) => [...prev, newServer])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create server")
      throw err
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="pl-0 md:pl-64">
        <Header title="Servers" subtitle={`${servers.length} servers configured`} />
        <div className="p-4 md:p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
              {error}
            </div>
          )}
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <p className="text-muted-foreground">Loading servers...</p>
            </div>
          ) : (
            <>
              {/* Toolbar */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 md:gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Filter status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Servers</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="starting">Starting</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-border">
                <Button
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  size="icon"
                  className="rounded-r-none"
                  onClick={() => setViewMode("grid")}
                >
                  <Grid3X3 className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="icon"
                  className="rounded-l-none"
                  onClick={() => setViewMode("list")}
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
              <CreateServerDialog onCreateServer={handleCreateServer} />
            </div>
          </div>

          {/* Server Grid */}
          {filteredServers.length > 0 ? (
            <div className={viewMode === "grid" ? "grid gap-4 md:grid-cols-2 xl:grid-cols-3" : "space-y-4"}>
              {filteredServers.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  onStart={handleStartServer}
                  onStop={handleStopServer}
                  onRestart={handleRestartServer}
                  onDelete={handleDeleteServer}
                  onInstall={handleInstallServer}
                  installProgress={installProgress[server.id]}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
              <p className="text-muted-foreground">No servers match your filter</p>
              <Button variant="link" className="mt-2" onClick={() => setFilter("all")}>
                Clear filter
              </Button>
            </div>
          )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
