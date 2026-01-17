import { useState, useEffect } from "react"
import { Server, Users, Cpu, HardDrive, Activity, Zap } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { ServerCard } from "@/components/server-card"
import { StatsCard } from "@/components/stats-card"
import { ResourceChart } from "@/components/resource-chart"
import { CreateServerDialog } from "@/components/create-server-dialog"
import { apiClient, wsClient } from "@/lib/api-client"
import type { Server as ServerType } from "@/lib/api"
import { mockStats } from "@/lib/mock-data"

export default function DashboardPage() {
  const [servers, setServers] = useState<ServerType[]>([])
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

  const totalPlayers = servers.reduce((sum, s) => sum + s.players, 0)
  const onlineServers = servers.filter((s) => s.status === "online").length
  const avgCpu = Math.round(
    servers.filter((s) => s.status === "online").reduce((sum, s) => sum + s.cpu, 0) / onlineServers || 0,
  )
  const totalMemory = servers.reduce((sum, s) => sum + s.memory, 0)

  const handleStartServer = async (id: string) => {
    try {
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, status: "starting" as const } : s)))
      const updated = await apiClient.startServer(id)
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start server")
      await loadServers() // Reload to get correct state
    }
  }

  const handleStopServer = async (id: string) => {
    try {
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, status: "stopping" as const } : s)))
      const updated = await apiClient.stopServer(id)
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop server")
      await loadServers() // Reload to get correct state
    }
  }

  const handleRestartServer = async (id: string) => {
    try {
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, status: "starting" as const } : s)))
      const updated = await apiClient.restartServer(id)
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restart server")
      await loadServers() // Reload to get correct state
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
    jarFile?: string
    assetsPath?: string
    maxPlayers: number
    maxMemory: number
    version?: string
    port?: number
    sessionToken?: string
    identityToken?: string
  }) => {
    const serverPath = `~/hytale/${data.name.toLowerCase().replace(/\s+/g, "-")}`;
    try {
      const newServer = await apiClient.createServer({
        name: data.name,
        path: serverPath,
        executable: "java",
        jarFile: data.jarFile || "HytaleServer.jar",
        assetsPath: `${serverPath}/Assets.zip`,
        port: data.port || 5520,
        maxPlayers: data.maxPlayers,
        maxMemory: data.maxMemory * 1024,
        version: data.version,
        sessionToken: data.sessionToken,
        identityToken: data.identityToken,
        bindAddress: "0.0.0.0",
        ip: "0.0.0.0",
      })
      setServers((prev) => [...prev, newServer])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create server")
      throw err
    }
  }

  const cpuChartData = mockStats.timestamps.map((t, i) => ({
    time: new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    value: mockStats.cpu[i],
  }))

  const memoryChartData = mockStats.timestamps.map((t, i) => ({
    time: new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    value: mockStats.memory[i],
  }))

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="pl-64">
        <Header title="Dashboard" subtitle="Monitor and manage your Hytale servers" />
        <div className="p-6">
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
              {/* Stats Overview */}
          <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              title="Total Servers"
              value={servers.length}
              subtitle={`${onlineServers} online`}
              icon={Server}
              trend={{ value: 12, isPositive: true }}
            />
            <StatsCard
              title="Online Players"
              value={totalPlayers}
              subtitle="Across all servers"
              icon={Users}
              trend={{ value: 8, isPositive: true }}
            />
            <StatsCard title="Average CPU" value={`${avgCpu}%`} subtitle="Active servers" icon={Cpu} />
            <StatsCard
              title="Memory Used"
              value={`${totalMemory.toFixed(1)}GB`}
              subtitle="Total allocation"
              icon={HardDrive}
            />
          </div>

          {/* Resource Charts */}
          <div className="mb-6 grid gap-4 md:grid-cols-2">
            <ResourceChart
              title="CPU Usage (Last 12 Hours)"
              data={cpuChartData}
              color="var(--chart-1)"
              maxValue={100}
            />
            <ResourceChart
              title="Memory Usage (Last 12 Hours)"
              data={memoryChartData}
              color="var(--chart-2)"
              unit="GB"
              maxValue={8}
            />
          </div>

          {/* Servers Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Your Servers</h2>
                <p className="text-sm text-muted-foreground">Manage and monitor your Hytale game servers</p>
              </div>
              <CreateServerDialog onCreateServer={handleCreateServer} />
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {servers.map((server) => (
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
          </div>

          {/* Quick Actions */}
          <div className="mt-6 rounded-lg border border-border bg-card p-6">
            <h3 className="mb-4 font-semibold">Quick Actions</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <button className="flex items-center gap-3 rounded-lg border border-border bg-secondary/50 p-4 text-left transition-colors hover:bg-secondary">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Activity className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">View Logs</p>
                  <p className="text-xs text-muted-foreground">Check server activity</p>
                </div>
              </button>
              <button className="flex items-center gap-3 rounded-lg border border-border bg-secondary/50 p-4 text-left transition-colors hover:bg-secondary">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Start All</p>
                  <p className="text-xs text-muted-foreground">Boot all offline servers</p>
                </div>
              </button>
              <button className="flex items-center gap-3 rounded-lg border border-border bg-secondary/50 p-4 text-left transition-colors hover:bg-secondary">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Player List</p>
                  <p className="text-xs text-muted-foreground">View all online players</p>
                </div>
              </button>
              <button className="flex items-center gap-3 rounded-lg border border-border bg-secondary/50 p-4 text-left transition-colors hover:bg-secondary">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <HardDrive className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Backup</p>
                  <p className="text-xs text-muted-foreground">Create server backups</p>
                </div>
              </button>
            </div>
          </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
