import { useState, useEffect } from "react"
import { Server, Users, Cpu, HardDrive } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { ServerCard } from "@/components/server-card"
import { StatsCard } from "@/components/stats-card"
import { ResourceChart } from "@/components/resource-chart"
import { CreateServerDialog } from "@/components/create-server-dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { apiClient, wsClient } from "@/lib/api-client"
import type { Server as ServerType, SystemStats } from "@/lib/api"

type TimeWindow = "1h" | "12h" | "24h" | "1w"

const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  "1h": "Last hour",
  "12h": "Last 12 hours",
  "24h": "Last 24 hours",
  "1w": "Last week",
}

export default function DashboardPage() {
  const [servers, setServers] = useState<ServerType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState<Record<string, any>>({})
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null)
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("12h")
  const [chartHistory, setChartHistory] = useState<Array<{ timestamp: number; cpu: number; memory: number }>>([])

  useEffect(() => {
    loadServers()
    loadSystemStats()
    
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
              cpu: data?.stats?.cpu ?? s.cpu,
              memory: data?.stats?.memory ?? s.memory,
              uptime: data?.stats?.uptime ?? s.uptime,
              players: data?.stats?.players ?? s.players,
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

    // Set up polling for system stats (every 5 seconds)
    const systemStatsInterval = setInterval(() => {
      loadSystemStats()
    }, 5000)

    return () => {
      wsClient.disconnect()
      clearInterval(systemStatsInterval)
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await apiClient.getSystemStatsHistory(timeWindow)
        setChartHistory(data || [])
      } catch (err) {
        console.error("Failed to load chart history:", err)
      }
    }
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [timeWindow])

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

  const loadSystemStats = async () => {
    try {
      const stats = await apiClient.getSystemStats()
      setSystemStats(stats)
    } catch (err) {
      console.error("Failed to load system stats:", err)
    }
  }

  const totalPlayers = servers.reduce((sum, s) => sum + s.players, 0)
  const onlineServers = servers.filter((s) => s.status === "online").length

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
    maxMemory: number
    port?: number
    backupEnabled?: boolean
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
        aotCacheEnabled: data.aotCacheEnabled,
        acceptEarlyPlugins: data.acceptEarlyPlugins,
      })
      setServers((prev) => [...prev, newServer])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create server")
      throw err
    }
  }

  const formatChartTime = (ts: number) => {
    const date = new Date(ts)
    if (timeWindow === "24h" || timeWindow === "1w") {
      return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    }
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  }

  const cpuChartData =
    chartHistory.length > 0
      ? chartHistory.map((stat) => ({
          time: formatChartTime(stat.timestamp),
          value: Math.round(stat.cpu * 10) / 10,
        }))
      : systemStats
        ? [
            {
              time: formatChartTime(systemStats.timestamp),
              value: Math.round(systemStats.cpu * 10) / 10,
            },
          ]
        : []

  const memoryChartData =
    chartHistory.length > 0
      ? chartHistory.map((stat) => ({
          time: formatChartTime(stat.timestamp),
          value: Math.round(stat.memory * 100) / 100,
        }))
      : systemStats
        ? [
            {
              time: formatChartTime(systemStats.timestamp),
              value: Math.round(systemStats.memory * 100) / 100,
            },
          ]
        : []

  const chartWindowLabel = TIME_WINDOW_LABELS[timeWindow]

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="pl-0 md:pl-64">
        <Header title="Dashboard" subtitle="Monitor and manage your Hytale servers" />
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
            <StatsCard 
              title="System CPU" 
              value={systemStats ? `${systemStats.cpu.toFixed(1)}%` : "—"} 
              subtitle="Total server usage" 
              icon={Cpu} 
            />
            <StatsCard
              title="System Memory"
              value={systemStats ? `${systemStats.memory.toFixed(2)}GB` : "—"}
              subtitle={systemStats ? `of ${systemStats.totalMemory.toFixed(2)}GB` : "Loading..."}
              icon={HardDrive}
            />
          </div>

          {/* Resource Charts */}
          <div className="mb-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-muted-foreground">System resource history</h3>
              <Tabs value={timeWindow} onValueChange={(v) => setTimeWindow(v as TimeWindow)}>
                <TabsList className="h-9">
                  {(["1h", "12h", "24h", "1w"] as const).map((w) => (
                    <TabsTrigger key={w} value={w} className="text-xs px-2 py-1">
                      {TIME_WINDOW_LABELS[w]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <ResourceChart
                title={`CPU Usage (${chartWindowLabel})`}
                data={cpuChartData}
                color="var(--chart-1)"
                maxValue={100}
              />
              <ResourceChart
                title={`Memory Usage (${chartWindowLabel})`}
                data={memoryChartData}
                color="var(--chart-2)"
                unit="GB"
                maxValue={systemStats ? systemStats.totalMemory : 8}
              />
            </div>
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
            </>
          )}
        </div>
      </main>
    </div>
  )
}
