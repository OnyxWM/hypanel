import { useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { Server as ServerIcon, Save, Play, Loader2 } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiClient } from "@/lib/api-client"
import type { Server, AdvancedBackupFrequency, RestartFrequency } from "@/lib/api"

export default function AutomationPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [servers, setServers] = useState<Server[]>([])
  const [selectedServer, setSelectedServer] = useState<string>("")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [runningBackupId, setRunningBackupId] = useState<string | null>(null)

  const requestedServerId = searchParams.get("serverId") || ""

  useEffect(() => {
    loadServers()
  }, [])

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

  useEffect(() => {
    if (!requestedServerId) return
    if (requestedServerId === selectedServer) return
    if (!servers.some((s) => s.id === requestedServerId)) return
    setSelectedServer(requestedServerId)
  }, [requestedServerId, selectedServer, servers])

  const handleServerChange = (serverId: string) => {
    setSelectedServer(serverId)
    if (serverId) {
      setSearchParams({ serverId })
    } else {
      setSearchParams({})
    }
  }

  const handleSave = async (
    serverId: string,
    updates: Partial<{
      advancedBackupEnabled: boolean
      advancedBackupFrequency: AdvancedBackupFrequency
      advancedBackupTime: string
      advancedBackupDayOfWeek: number
      advancedBackupMaxCount: number
      restartScheduleEnabled: boolean
      restartFrequency: RestartFrequency
      restartTime: string
      restartDayOfWeek: number
    }>
  ) => {
    try {
      setSavingId(serverId)
      const updated = await apiClient.updateServer(serverId, updates)
      setServers((prev) => prev.map((s) => (s.id === serverId ? updated : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSavingId(null)
    }
  }

  const handleRunNow = async (serverId: string) => {
    try {
      setRunningBackupId(serverId)
      setError(null)
      const result = await apiClient.triggerAdvancedBackup(serverId)
      setServers((prev) => prev.map((s) => (s.id === serverId ? result.server : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run backup")
    } finally {
      setRunningBackupId(null)
    }
  }

  const server = servers.find((s) => s.id === selectedServer)

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="pl-0 md:pl-64">
        <Header
          title="Automation"
          subtitle="Configure scheduled restarts and advanced backups"
        />
        <div className="p-4 md:p-6 space-y-6">
          <div className="flex flex-wrap items-center gap-2 md:gap-4">
            <Select value={selectedServer} onValueChange={handleServerChange} disabled={isLoading}>
              <SelectTrigger className="w-full md:w-[250px]">
                <SelectValue placeholder={isLoading ? "Loading servers..." : "Select server"} />
              </SelectTrigger>
              <SelectContent>
                {servers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${
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
          {error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
              {error}
            </div>
          )}
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : servers.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No Servers</CardTitle>
                <CardDescription>
                  Create a server first to configure automation.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : !selectedServer ? (
            <Card>
              <CardHeader>
                <CardTitle>Select a server</CardTitle>
                <CardDescription>
                  Choose a server from the dropdown above to configure scheduled restarts and advanced backups.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : server ? (
            <AutomationContent
              server={server}
              onSave={(updates) => handleSave(server.id, updates)}
              onRunNow={() => handleRunNow(server.id)}
              isSaving={savingId === server.id}
              isRunningBackup={runningBackupId === server.id}
            />
          ) : null}
        </div>
      </main>
    </div>
  )
}

interface AutomationContentProps {
  server: Server
  onSave: (updates: Partial<{
    advancedBackupEnabled: boolean
    advancedBackupFrequency: AdvancedBackupFrequency
    advancedBackupTime: string
    advancedBackupDayOfWeek: number
    advancedBackupMaxCount: number
    restartScheduleEnabled: boolean
    restartFrequency: RestartFrequency
    restartTime: string
    restartDayOfWeek: number
  }>) => void
  onRunNow: () => void
  isSaving: boolean
  isRunningBackup: boolean
}

function AutomationContent({
  server,
  onSave,
  onRunNow,
  isSaving,
  isRunningBackup,
}: AutomationContentProps) {
  const [advancedEnabled, setAdvancedEnabled] = useState(server.advancedBackupEnabled ?? false)
  const [advancedFrequency, setAdvancedFrequency] = useState<AdvancedBackupFrequency>(
    (server.advancedBackupFrequency as AdvancedBackupFrequency) ?? "daily"
  )
  const [advancedTime, setAdvancedTime] = useState(server.advancedBackupTime ?? "03:00")
  const [advancedDayOfWeek, setAdvancedDayOfWeek] = useState(server.advancedBackupDayOfWeek ?? 0)
  const [advancedMaxCount, setAdvancedMaxCount] = useState(server.advancedBackupMaxCount ?? 1)
  const [restartEnabled, setRestartEnabled] = useState(server.restartScheduleEnabled ?? false)
  const [restartFrequency, setRestartFrequency] = useState<RestartFrequency>(
    (server.restartFrequency as RestartFrequency) ?? "daily"
  )
  const [restartTime, setRestartTime] = useState(server.restartTime ?? "03:00")
  const [restartDayOfWeek, setRestartDayOfWeek] = useState(server.restartDayOfWeek ?? 0)

  useEffect(() => {
    setAdvancedEnabled(server.advancedBackupEnabled ?? false)
    setAdvancedFrequency((server.advancedBackupFrequency as AdvancedBackupFrequency) ?? "daily")
    setAdvancedTime(server.advancedBackupTime ?? "03:00")
    setAdvancedDayOfWeek(server.advancedBackupDayOfWeek ?? 0)
    setAdvancedMaxCount(server.advancedBackupMaxCount ?? 1)
    setRestartEnabled(server.restartScheduleEnabled ?? false)
    setRestartFrequency((server.restartFrequency as RestartFrequency) ?? "daily")
    setRestartTime(server.restartTime ?? "03:00")
    setRestartDayOfWeek(server.restartDayOfWeek ?? 0)
  }, [
    server.advancedBackupEnabled,
    server.advancedBackupFrequency,
    server.advancedBackupTime,
    server.advancedBackupDayOfWeek,
    server.advancedBackupMaxCount,
    server.restartScheduleEnabled,
    server.restartFrequency,
    server.restartTime,
    server.restartDayOfWeek,
  ])

  const hasChanges =
    advancedEnabled !== (server.advancedBackupEnabled ?? false) ||
    advancedFrequency !== ((server.advancedBackupFrequency as AdvancedBackupFrequency) ?? "daily") ||
    advancedTime !== (server.advancedBackupTime ?? "03:00") ||
    advancedDayOfWeek !== (server.advancedBackupDayOfWeek ?? 0) ||
    advancedMaxCount !== (server.advancedBackupMaxCount ?? 1) ||
    restartEnabled !== (server.restartScheduleEnabled ?? false) ||
    restartFrequency !== ((server.restartFrequency as RestartFrequency) ?? "daily") ||
    restartTime !== (server.restartTime ?? "03:00") ||
    restartDayOfWeek !== (server.restartDayOfWeek ?? 0)

  const handleSave = () => {
    onSave({
      advancedBackupEnabled: advancedEnabled,
      advancedBackupFrequency: advancedFrequency,
      advancedBackupTime: advancedTime,
      advancedBackupDayOfWeek: advancedDayOfWeek,
      advancedBackupMaxCount: Math.max(1, advancedMaxCount),
      restartScheduleEnabled: restartEnabled,
      restartFrequency,
      restartTime,
      restartDayOfWeek,
    })
  }

  const lastBackupText = server.lastAdvancedBackupAt
    ? new Date(server.lastAdvancedBackupAt).toLocaleString()
    : "Never"

  return (
    <div className="space-y-6">
      {/* Scheduled restart */}
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader>
          <CardTitle className="text-base">Scheduled restart</CardTitle>
          <CardDescription>
            Automatically restart the server on a schedule. Each run checks for updates and applies them before restarting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`restart-enabled-${server.id}`}
              checked={restartEnabled}
              onCheckedChange={(checked) => setRestartEnabled(checked === true)}
            />
            <Label htmlFor={`restart-enabled-${server.id}`} className="text-sm font-normal cursor-pointer">
              Enable scheduled restart
            </Label>
          </div>
          {restartEnabled && (
            <>
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select
                  value={restartFrequency}
                  onValueChange={(v) => setRestartFrequency(v as RestartFrequency)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="every_1h">Every hour</SelectItem>
                    <SelectItem value="every_12h">Every 12 hours</SelectItem>
                    <SelectItem value="every_6h">Every 6 hours</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!["every_1h", "every_6h", "every_12h"].includes(restartFrequency) && (
                <div className="space-y-2">
                  <Label htmlFor={`restart-time-${server.id}`}>Time</Label>
                  <Input
                    id={`restart-time-${server.id}`}
                    type="time"
                    value={restartTime}
                    onChange={(e) => setRestartTime(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Time is in the panel server&apos;s local timezone.
                  </p>
                </div>
              )}
              {restartFrequency === "weekly" && (
                <div className="space-y-2">
                  <Label>Day of week</Label>
                  <Select
                    value={String(restartDayOfWeek)}
                    onValueChange={(v) => setRestartDayOfWeek(parseInt(v, 10))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Sunday</SelectItem>
                      <SelectItem value="1">Monday</SelectItem>
                      <SelectItem value="2">Tuesday</SelectItem>
                      <SelectItem value="3">Wednesday</SelectItem>
                      <SelectItem value="4">Thursday</SelectItem>
                      <SelectItem value="5">Friday</SelectItem>
                      <SelectItem value="6">Saturday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Advanced backup */}
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <ServerIcon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Advanced backup</CardTitle>
                <CardDescription>
                  Archive the whole server folder (configs, worlds, mods, etc.) on a schedule. Last backup: {lastBackupText}
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onRunNow}
              disabled={isRunningBackup || server.installState !== "INSTALLED"}
              className="gap-2"
            >
              {isRunningBackup ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run now
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`advanced-backup-enabled-${server.id}`}
              checked={advancedEnabled}
              onCheckedChange={(checked) => setAdvancedEnabled(checked === true)}
            />
            <Label htmlFor={`advanced-backup-enabled-${server.id}`} className="text-sm font-normal cursor-pointer">
              Enable advanced backup
            </Label>
          </div>
          {advancedEnabled && (
            <>
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select
                  value={advancedFrequency}
                  onValueChange={(v) => setAdvancedFrequency(v as AdvancedBackupFrequency)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`advanced-backup-time-${server.id}`}>Time</Label>
                <Input
                  id={`advanced-backup-time-${server.id}`}
                  type="time"
                  value={advancedTime}
                  onChange={(e) => setAdvancedTime(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Time is in the panel server&apos;s local timezone.
                </p>
              </div>
              {advancedFrequency === "weekly" && (
                <div className="space-y-2">
                  <Label>Day of week</Label>
                  <Select
                    value={String(advancedDayOfWeek)}
                    onValueChange={(v) => setAdvancedDayOfWeek(parseInt(v, 10))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Sunday</SelectItem>
                      <SelectItem value="1">Monday</SelectItem>
                      <SelectItem value="2">Tuesday</SelectItem>
                      <SelectItem value="3">Wednesday</SelectItem>
                      <SelectItem value="4">Thursday</SelectItem>
                      <SelectItem value="5">Friday</SelectItem>
                      <SelectItem value="6">Saturday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor={`advanced-backup-max-${server.id}`}>Max backups to keep</Label>
                <Input
                  id={`advanced-backup-max-${server.id}`}
                  type="number"
                  min={1}
                  value={advancedMaxCount}
                  onChange={(e) => setAdvancedMaxCount(Math.max(1, parseInt(e.target.value) || 1))}
                />
                <p className="text-xs text-muted-foreground">
                  How many archive files to retain per server. Older backups are deleted automatically.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {hasChanges && (
        <Button onClick={handleSave} disabled={isSaving} className="gap-2">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
      )}
    </div>
  )
}
