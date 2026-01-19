import { useState, useEffect, useRef } from "react"
import { useLocation, useNavigate, useParams, useSearchParams, Link } from "react-router-dom"
import { ArrowLeft, Play, Square, RotateCcw, Settings, Copy, Key, RefreshCw, Upload, Trash2, Users, Cpu, HardDrive, Clock } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { StatsCard } from "@/components/stats-card"
import { ResourceChart } from "@/components/resource-chart"
import { ServerConsole } from "@/components/server-console"
import { ServerConfig } from "@/components/server-config"
import { ServerSettings } from "@/components/server-settings"
import { WorldList } from "@/components/world-list"
import { WorldConfig } from "@/components/world-config"
import { AuthGuidance } from "@/components/auth-guidance"
import { PlayerList } from "@/components/player-list"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { apiClient, wsClient } from "@/lib/api-client"
import type { Server, ConsoleLog, Player, ModFile } from "@/lib/api"

export default function ServerDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [server, setServer] = useState<Server | null>(null)
  const [logs, setLogs] = useState<ConsoleLog[]>([])
  const [stats, setStats] = useState<any[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [mods, setMods] = useState<ModFile[]>([])
  const [modsError, setModsError] = useState<string | null>(null)
  const [isModsLoading, setIsModsLoading] = useState(false)
  const [isUploadingMod, setIsUploadingMod] = useState(false)
  const [deletingModName, setDeletingModName] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAutostartSaving, setIsAutostartSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedWorld, setSelectedWorld] = useState<string | null>(null)
  const modFileInputRef = useRef<HTMLInputElement | null>(null)

  const shouldAutoOpenSettings = searchParams.get("settings") === "1"

  const handleSettingsOpenChange = (open: boolean) => {
    setIsSettingsOpen(open)

    // If opened via `?settings=1`, remove it on close so refresh/back doesn’t keep reopening.
    if (!open && shouldAutoOpenSettings) {
      const next = new URLSearchParams(searchParams)
      next.delete("settings")
      const nextSearch = next.toString()
      navigate(
        { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : "" },
        { replace: true },
      )
    }
  }

  useEffect(() => {
    if (!id) return

    loadServer()
    loadLogs()
    loadStats()
    loadPlayers()
    loadMods()

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
        // Append to chart series (keep ~8 minutes: 100 points @ 5s interval).
        setStats((prev) => {
          const next = [
            ...prev,
            {
              timestamp: Date.now(),
              cpu: data.stats.cpu ?? 0,
              memory: data.stats.memory ?? 0,
              players: data.stats.players ?? 0,
            },
          ]
          return next.slice(-100)
        })

        setServer((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            cpu: data.stats.cpu ?? prev.cpu,
            memory: data.stats.memory ?? prev.memory,
            uptime: data.stats.uptime ?? prev.uptime,
            players: data.stats.players ?? prev.players,
          }
        })
      }
    })

    wsClient.on("player:join", (data: any) => {
      if (data.serverId === id) {
        loadPlayers()
      }
    })

    wsClient.on("player:leave", (data: any) => {
      if (data.serverId === id) {
        loadPlayers()
      }
    })

    return () => {
      wsClient.unsubscribe()
    }
  }, [id])

  useEffect(() => {
    if (shouldAutoOpenSettings) {
      setIsSettingsOpen(true)
    }
  }, [shouldAutoOpenSettings])

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
      // Backend returns newest-first; store chronological for charting (oldest -> newest).
      setStats(Array.isArray(data) ? [...data].reverse() : [])
    } catch (err) {
      console.error("Failed to load stats:", err)
    }
  }

  const loadPlayers = async () => {
    if (!id) return
    try {
      const data = await apiClient.getServerPlayers(id)
      setPlayers(data)
    } catch (err) {
      console.error("Failed to load players:", err)
    }
  }

  const loadMods = async () => {
    if (!id) return
    try {
      setIsModsLoading(true)
      setModsError(null)
      const data = await apiClient.getServerMods(id)
      setMods(data)
    } catch (err) {
      setModsError(err instanceof Error ? err.message : "Failed to load mods")
    } finally {
      setIsModsLoading(false)
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

  const handleToggleAutostart = async () => {
    if (!id || !server) return
    const nextAutostart = !(server.autostart === true)
    const wasOffline = server.status === "offline"
    try {
      setIsAutostartSaving(true)
      setError(null)

      // Optimistic update
      setServer((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          autostart: nextAutostart,
          status: nextAutostart && wasOffline ? ("starting" as const) : prev.status,
        }
      })

      let updated = await apiClient.updateServer(id, { autostart: nextAutostart })
      if (nextAutostart && wasOffline) {
        updated = await apiClient.startServer(id)
      }
      setServer(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update autostart")
      await loadServer()
    } finally {
      setIsAutostartSaving(false)
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

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
    const units = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    const value = bytes / Math.pow(1024, i)
    return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
  }

  const formatChartTime = (ts: any) => {
    const ms = typeof ts === "number" ? ts : Number(ts)
    const date = Number.isFinite(ms) ? new Date(ms) : new Date()
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  }

  const toFiniteNumber = (value: any, fallback: number = 0) => {
    const n = typeof value === "number" ? value : Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  // Prepare chart data from stats (~8 minutes: 100 points @ 5s interval).
  // `stats` is stored chronological (oldest -> newest).
  const chartStats = stats.slice(-100)

  const cpuChartData = chartStats.map((stat) => ({
    time: formatChartTime(stat.timestamp),
    value: toFiniteNumber(stat.cpu, 0),
  }))

  const memoryChartData = chartStats.map((stat) => ({
    time: formatChartTime(stat.timestamp),
    value: toFiniteNumber(stat.memory, 0) / 1024, // Convert MB to GB
  }))

  const playersChartData = chartStats.map((stat) => ({
    time: formatChartTime(stat.timestamp),
    value: toFiniteNumber(stat.players, 0),
  }))

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <main className="pl-0 md:pl-64">
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
        <main className="pl-0 md:pl-64">
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
      <main className="pl-0 md:pl-64">
        <Header title={server.name} subtitle={`${server.ip}:${server.port}`} />
        <div className="p-4 md:p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
              {error}
            </div>
          )}
          {/* Back Link & Actions */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 md:gap-4">
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
                  <Button variant="outline" onClick={() => navigate(`/console?serverId=${encodeURIComponent(server.id)}`)}>
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
              <Button
                variant="outline"
                onClick={handleToggleAutostart}
                disabled={isAutostartSaving}
              >
                {isAutostartSaving
                  ? "Saving..."
                  : server.autostart === true
                    ? "Disable Autostart"
                    : "Enable Autostart"}
              </Button>
              <Button variant="outline" onClick={() => setIsSettingsOpen(true)}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Button>
            </div>
          </div>

          <Dialog open={isSettingsOpen} onOpenChange={handleSettingsOpenChange}>
            <DialogContent className="sm:max-w-[900px] max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Server Settings</DialogTitle>
              </DialogHeader>
              <ServerSettings
                serverId={server.id}
                serverStatus={server.status}
                onUpdated={(updated) => setServer(updated)}
              />
            </DialogContent>
          </Dialog>

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
                <TabsTrigger value="mods">Mods</TabsTrigger>
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
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium">Online Players</h3>
                    <p className="text-sm text-muted-foreground">
                      {players.length} player{players.length !== 1 ? "s" : ""} online
                    </p>
                  </div>
                  {server.status === "online" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        if (!id) return
                        try {
                          await apiClient.refreshServerPlayers(id)
                          await loadPlayers()
                        } catch (err) {
                          console.error("Failed to refresh players:", err)
                        }
                      }}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh
                    </Button>
                  )}
                </div>
                <PlayerList 
                  players={players} 
                  showServerName={false}
                  emptyMessage="No players online on this server"
                />
              </div>
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

            <TabsContent value="mods">
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle className="text-base">Mods</CardTitle>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={loadMods}
                        disabled={isModsLoading || isUploadingMod}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refresh
                      </Button>
                      <input
                        ref={modFileInputRef}
                        type="file"
                        accept=".jar,.zip"
                        className="hidden"
                        onChange={async (e) => {
                          if (!id) return
                          const file = e.target.files?.[0]
                          if (!file) return
                          try {
                            setIsUploadingMod(true)
                            setModsError(null)
                            const updated = await apiClient.uploadServerMod(id, file)
                            setMods(updated)
                          } catch (err) {
                            setModsError(err instanceof Error ? err.message : "Failed to upload mod")
                          } finally {
                            setIsUploadingMod(false)
                            e.target.value = ""
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={() => modFileInputRef.current?.click()}
                        disabled={isUploadingMod || isModsLoading}
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        Upload Mod
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {modsError && (
                    <div className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                      {modsError}
                    </div>
                  )}

                  {isModsLoading ? (
                    <p className="text-center text-muted-foreground">Loading mods...</p>
                  ) : mods.length === 0 ? (
                    <p className="text-center text-muted-foreground">No mods found in the server mods folder</p>
                  ) : (
                    <div className="space-y-2">
                      {mods.map((m) => (
                        <div
                          key={m.name}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-mono text-sm">{m.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatBytes(m.size)} • {new Date(m.modified).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={
                                isModsLoading ||
                                isUploadingMod ||
                                (deletingModName !== null && deletingModName !== m.name)
                              }
                              onClick={async () => {
                                if (!id) return
                                try {
                                  setDeletingModName(m.name)
                                  setModsError(null)
                                  const updated = await apiClient.deleteServerMod(id, m.name)
                                  setMods(updated)
                                } catch (err) {
                                  setModsError(err instanceof Error ? err.message : "Failed to delete mod")
                                } finally {
                                  setDeletingModName(null)
                                }
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}
