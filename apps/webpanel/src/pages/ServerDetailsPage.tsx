import { useState, useEffect } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, Play, Square, RotateCcw, Settings, Copy, Key } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { StatsCard } from "@/components/stats-card"
import { ResourceChart } from "@/components/resource-chart"
import { ServerConsole } from "@/components/server-console"
import { ServerConfig } from "@/components/server-config"
import { WorldList } from "@/components/world-list"
import { WorldConfig } from "@/components/world-config"
import { AuthGuidance } from "@/components/auth-guidance"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { apiClient, wsClient } from "@/lib/api-client"
import type { Server, ConsoleLog } from "@/lib/api"
import { Users, Cpu, HardDrive, Clock } from "lucide-react"

export default function ServerDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const [server, setServer] = useState<Server | null>(null)
  const [logs, setLogs] = useState<ConsoleLog[]>([])
  const [stats, setStats] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedWorld, setSelectedWorld] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    loadServer()
    loadLogs()
    loadStats()

    // Set up WebSocket for real-time updates
    wsClient.connect()
    wsClient.subscribe(id)

    wsClient.on("server:status", (data: any) => {
      if (data.serverId === id) {
        setServer((prev) => (prev ? { ...prev, status: data.status } : prev))
      }
    })

    wsClient.on("server:log", (data: any) => {
      if (data.serverId === id && data.log) {
        setLogs((prev) => [...prev, data.log])
      }
    })

    wsClient.on("server:stats", (data: any) => {
      if (data.serverId === id && data.stats) {
        setServer((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            cpu: data.stats.cpu || prev.cpu,
            memory: data.stats.memory || prev.memory,
            uptime: data.stats.uptime || prev.uptime,
          }
        })
      }
    })

    return () => {
      wsClient.unsubscribe()
    }
  }, [id])

  const loadServer = async () => {
    if (!id) return
    try {
      setIsLoading(true)
      setError(null)
      const data = await apiClient.getServer(id)
      setServer(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load server")
      console.error("Failed to load server:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const loadLogs = async () => {
    if (!id) return
    try {
      const data = await apiClient.getLogs(id)
      setLogs(data)
    } catch (err) {
      console.error("Failed to load logs:", err)
    }
  }

  const loadStats = async () => {
    if (!id) return
    try {
      const data = await apiClient.getStats(id, 100)
      setStats(data)
    } catch (err) {
      console.error("Failed to load stats:", err)
    }
  }

  const handleStart = async () => {
    if (!id) return
    try {
      setServer((prev) => (prev ? { ...prev, status: "starting" } : prev))
      const updated = await apiClient.startServer(id)
      setServer(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start server")
      await loadServer()
    }
  }

  const handleStop = async () => {
    if (!id) return
    try {
      setServer((prev) => (prev ? { ...prev, status: "stopping" } : prev))
      const updated = await apiClient.stopServer(id)
      setServer(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop server")
      await loadServer()
    }
  }

  const handleRestart = async () => {
    if (!id) return
    try {
      setServer((prev) => (prev ? { ...prev, status: "starting" } : prev))
      const updated = await apiClient.restartServer(id)
      setServer(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restart server")
      await loadServer()
    }
  }

  const handleSendCommand = async (command: string) => {
    if (!id) return
    try {
      await apiClient.sendCommand(id, command)
      // Command will appear in logs via WebSocket
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send command")
    }
  }

  const formatUptime = (seconds: number) => {
    if (seconds === 0) return "—"
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}d ${hours}h ${mins}m`
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
  }

  // Prepare chart data from stats
  const cpuChartData = stats
    .slice(-12)
    .map((stat) => ({
      time: new Date(stat.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      value: stat.cpu || 0,
    }))

  const memoryChartData = stats
    .slice(-12)
    .map((stat) => ({
      time: new Date(stat.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      value: (stat.memory || 0) / 1024, // Convert MB to GB
    }))

  const playersChartData = stats
    .slice(-12)
    .map((stat) => ({
      time: new Date(stat.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      value: stat.players || 0,
    }))

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <main className="pl-64">
          <div className="flex h-[50vh] items-center justify-center">
            <p className="text-muted-foreground">Loading server...</p>
          </div>
        </main>
      </div>
    )
  }

  if (!server) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <main className="pl-64">
          <div className="flex h-[50vh] items-center justify-center">
            <p className="text-muted-foreground">Server not found</p>
          </div>
        </main>
      </div>
    )
  }

  const statusConfig = {
    online: { label: "Online", className: "bg-success/20 text-success border-success/30" },
    offline: { label: "Offline", className: "bg-muted text-muted-foreground border-border" },
    starting: { label: "Starting", className: "bg-warning/20 text-warning border-warning/30" },
    stopping: { label: "Stopping", className: "bg-warning/20 text-warning border-warning/30" },
    auth_required: { label: "Auth Required", className: "bg-destructive/20 text-destructive border-destructive/30" },
  }

  const status = statusConfig[server.status]

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="pl-64">
        <Header title={server.name} subtitle={`${server.ip}:${server.port}`} />
        <div className="p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
              {error}
            </div>
          )}
          {/* Back Link & Actions */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <Link
              to="/servers"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Servers
            </Link>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={status.className}>
                <span
                  className={`mr-1.5 h-1.5 w-1.5 rounded-full ${
                    server.status === "online"
                      ? "bg-success"
                      : server.status === "offline"
                        ? "bg-muted-foreground"
                        : server.status === "auth_required"
                          ? "bg-destructive animate-pulse"
                          : "bg-warning animate-pulse"
                  }`}
                />
                {status.label}
              </Badge>
              {server.status === "offline" ? (
                <Button onClick={handleStart}>
                  <Play className="mr-2 h-4 w-4" />
                  Start
                </Button>
              ) : server.status === "online" ? (
                <>
                  <Button variant="secondary" onClick={handleStop}>
                    <Square className="mr-2 h-4 w-4" />
                    Stop
                  </Button>
                  <Button variant="secondary" onClick={handleRestart}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Restart
                  </Button>
                </>
              ) : server.status === "auth_required" ? (
                <>
                  <Button variant="outline" onClick={() => window.location.hash = '#console'}>
                    <Key className="mr-2 h-4 w-4" />
                    Authenticate
                  </Button>
                  <Button variant="secondary" onClick={handleStop}>
                    <Square className="mr-2 h-4 w-4" />
                    Stop
                  </Button>
                </>
              ) : (
                <Button disabled>{server.status === "starting" ? "Starting..." : "Stopping..."}</Button>
              )}
              <Button variant="outline" asChild>
                <Link to={`/servers/${server.id}`}>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard title="Players" value={`${server.players}/${server.maxPlayers}`} icon={Users} />
            <StatsCard title="CPU Usage" value={`${server.cpu.toFixed(1)}%`} icon={Cpu} />
            <StatsCard
              title="Memory"
              value={`${(server.memory / 1024).toFixed(1)}/${(server.maxMemory / 1024).toFixed(1)}GB`}
              icon={HardDrive}
            />
            <StatsCard title="Uptime" value={formatUptime(server.uptime)} icon={Clock} />
          </div>

          {/* Tabs */}
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="console">Console</TabsTrigger>
              <TabsTrigger value="players">Players</TabsTrigger>
              <TabsTrigger value="config">Config</TabsTrigger>
              <TabsTrigger value="worlds">Worlds</TabsTrigger>
              <TabsTrigger value="files">Files</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              {/* Auth Guidance */}
              {server.status === "auth_required" && (
                <AuthGuidance serverId={server.id} />
              )}
              
              {/* Charts */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <ResourceChart title="CPU Usage" data={cpuChartData} color="var(--chart-1)" maxValue={100} />
                <ResourceChart
                  title="Memory Usage"
                  data={memoryChartData}
                  color="var(--chart-2)"
                  unit="GB"
                  maxValue={server.maxMemory / 1024}
                />
                <ResourceChart
                  title="Player Count"
                  data={playersChartData}
                  color="var(--chart-3)"
                  unit=""
                  maxValue={server.maxPlayers}
                />
              </div>

              {/* Server Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Server Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Address</p>
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-sm">
                          {server.ip}:{server.port}
                        </p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => navigator.clipboard.writeText(`${server.ip}:${server.port}`)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Version</p>
                      <p className="font-mono text-sm">{server.version}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Created</p>
                      <p className="text-sm">{new Date(server.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="console" className="space-y-4">
              {server.status === "auth_required" && (
                <AuthGuidance serverId={server.id} />
              )}
              <div className="h-[400px]">
                <ServerConsole 
                  logs={logs} 
                  onSendCommand={handleSendCommand} 
                  isLoading={server.status === "starting" || server.status === "stopping"} 
                />
              </div>
            </TabsContent>

            <TabsContent value="players">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Online Players</CardTitle>
                </CardHeader>
                <CardContent>
                  {server.players > 0 ? (
                    <p className="text-center text-muted-foreground">{server.players} player(s) online</p>
                  ) : (
                    <p className="text-center text-muted-foreground">No players online</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="config">
              <ServerConfig serverId={server.id} serverStatus={server.status} />
            </TabsContent>

            <TabsContent value="worlds" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-1">
                  <WorldList 
                    serverId={server.id}
                    onWorldSelect={setSelectedWorld}
                    selectedWorld={selectedWorld || undefined}
                  />
                </div>
                <div className="lg:col-span-2">
                  {selectedWorld ? (
                    <WorldConfig 
                      serverId={server.id}
                      serverStatus={server.status}
                      world={selectedWorld}
                    />
                  ) : (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">World Configuration</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-center py-8">
                          <p className="text-muted-foreground">Select a world from the list to view and edit its configuration</p>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="files">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Server Files</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-center text-muted-foreground">File manager coming soon</p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}
