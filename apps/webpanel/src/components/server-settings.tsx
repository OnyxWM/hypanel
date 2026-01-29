import { useEffect, useMemo, useState } from "react"
import { Loader2, Save, RefreshCw } from "lucide-react"
import { apiClient } from "@/lib/api-client"
import type { Server, ServerStatus } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"

interface ServerSettingsProps {
  serverId: string
  serverStatus: ServerStatus
  onUpdated?: (server: Server) => void
}

function mbToGbRounded(mb: number): number {
  if (!Number.isFinite(mb) || mb <= 0) return 1
  return Math.max(1, Math.round(mb / 1024))
}

function gbToMb(gb: number): number {
  if (!Number.isFinite(gb) || gb <= 0) return 1024
  return Math.max(1024, Math.round(gb) * 1024)
}

export function ServerSettings({ serverId, serverStatus, onUpdated }: ServerSettingsProps) {
  const [server, setServer] = useState<Server | null>(null)
  const [original, setOriginal] = useState<Server | null>(null)

  const [title, setTitle] = useState("")
  const [ramGb, setRamGb] = useState(4)
  const [port, setPort] = useState(5520)
  const [backupEnabled, setBackupEnabled] = useState(true)
  const [backupFrequency, setBackupFrequency] = useState(30)
  const [backupMaxCount, setBackupMaxCount] = useState(5)
  const [aotCacheEnabled, setAotCacheEnabled] = useState(false)
  const [acceptEarlyPlugins, setAcceptEarlyPlugins] = useState(false)

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const canEdit = serverStatus === "offline"

  const load = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const s = await apiClient.getServer(serverId)
      setServer(s)
      setOriginal(s)
      setTitle(s.name || "")
      setRamGb(mbToGbRounded(s.maxMemory))
      setPort(s.port || 5520)
      setBackupEnabled(s.backupEnabled ?? true)
      setBackupFrequency(s.backupFrequency ?? 30)
      setBackupMaxCount(s.backupMaxCount ?? 5)
      setAotCacheEnabled(s.aotCacheEnabled ?? false)
      setAcceptEarlyPlugins(s.acceptEarlyPlugins ?? false)
      setSuccess(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load server")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])

  const hasChanges = useMemo(() => {
    if (!original) return false
    const nextName = title.trim()
    const nextMaxMemory = gbToMb(ramGb)
    const nextPort = port
    const nextBackupEnabled = backupEnabled
    const nextBackupFrequency = backupFrequency
    const nextBackupMaxCount = backupMaxCount
    const nextAotCacheEnabled = aotCacheEnabled
    const nextAcceptEarlyPlugins = acceptEarlyPlugins
    return (
      nextName !== original.name ||
      nextMaxMemory !== original.maxMemory ||
      nextPort !== original.port ||
      nextBackupEnabled !== (original.backupEnabled ?? true) ||
      nextBackupFrequency !== (original.backupFrequency ?? 30) ||
      nextBackupMaxCount !== (original.backupMaxCount ?? 5) ||
      nextAotCacheEnabled !== (original.aotCacheEnabled ?? false) ||
      nextAcceptEarlyPlugins !== (original.acceptEarlyPlugins ?? false)
    )
  }, [original, title, ramGb, port, backupEnabled, backupFrequency, backupMaxCount, aotCacheEnabled, acceptEarlyPlugins])

  const handleReset = () => {
    if (!original) return
    setTitle(original.name || "")
    setRamGb(mbToGbRounded(original.maxMemory))
    setPort(original.port || 5520)
    setBackupEnabled(original.backupEnabled ?? true)
    setBackupFrequency(original.backupFrequency ?? 30)
    setBackupMaxCount(original.backupMaxCount ?? 5)
    setAotCacheEnabled(original.aotCacheEnabled ?? false)
    setAcceptEarlyPlugins(original.acceptEarlyPlugins ?? false)
    setError(null)
    setSuccess(false)
  }

  const handleSave = async () => {
    if (!original) return

    try {
      setIsSaving(true)
      setError(null)
      setSuccess(false)

      const updated = await apiClient.updateServer(serverId, {
        name: title.trim(),
        maxMemory: gbToMb(ramGb),
        port,
        backupEnabled,
        backupFrequency,
        backupMaxCount,
        aotCacheEnabled,
        acceptEarlyPlugins,
      })

      setServer(updated)
      setOriginal(updated)
      onUpdated?.(updated)

      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings")
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="ml-2">Loading settings...</span>
      </div>
    )
  }

  if (error && !server) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (!server) {
    return <div className="text-center p-8 text-muted-foreground">Server not found</div>
  }

  return (
    <div className="space-y-6">
      {!canEdit && (
        <Alert variant="destructive">
          <AlertDescription>Server must be stopped before editing settings.</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-success bg-success/10">
          <AlertDescription className="text-success">Settings updated successfully!</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Server Settings</h3>
          <p className="text-sm text-muted-foreground">Update server resources and backups</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleReset} disabled={!hasChanges || isSaving}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reset
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || !canEdit || isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Changes
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="serverTitle">Server Title</Label>
              <Input
                id="serverTitle"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={!canEdit}
                placeholder="My Hytale Server"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="serverPort">Port</Label>
              <Input
                id="serverPort"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(Math.max(1, Math.min(65535, parseInt(e.target.value) || 1)))}
                disabled={!canEdit}
                placeholder="5520"
              />
              <p className="text-xs text-muted-foreground">
                If you change the port, make sure your firewall and client connection use the new value.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Memory (GB)</Label>
                <span className="text-sm text-muted-foreground">{ramGb}GB</span>
              </div>
              <Slider
                value={[ramGb]}
                onValueChange={([value]) => setRamGb(value)}
                min={1}
                max={64}
                step={1}
                disabled={!canEdit}
              />
              <div className="grid gap-2 pt-2">
                <Label htmlFor="ramGb">Memory (GB)</Label>
                <Input
                  id="ramGb"
                  type="number"
                  min={1}
                  max={64}
                  value={ramGb}
                  onChange={(e) => setRamGb(Math.max(1, Math.min(64, parseInt(e.target.value) || 1)))}
                  disabled={!canEdit}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Backups</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="backupEnabled"
                checked={backupEnabled}
                onCheckedChange={(checked) => setBackupEnabled(checked === true)}
                disabled={!canEdit}
              />
              <Label htmlFor="backupEnabled" className="text-sm font-normal cursor-pointer">
                Enable backups
              </Label>
            </div>
            {backupEnabled && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="backupFrequency">Backup Frequency (minutes)</Label>
                  <Input
                    id="backupFrequency"
                    type="number"
                    min={1}
                    value={backupFrequency}
                    onChange={(e) => setBackupFrequency(Math.max(1, parseInt(e.target.value) || 30))}
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="backupMaxCount">Max Backups Stored</Label>
                  <Input
                    id="backupMaxCount"
                    type="number"
                    min={1}
                    value={backupMaxCount}
                    onChange={(e) => setBackupMaxCount(Math.max(1, parseInt(e.target.value) || 5))}
                    disabled={!canEdit}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ahead-of-Time Caching</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start space-x-2">
              <Checkbox
                id="aotCacheEnabled"
                checked={aotCacheEnabled}
                onCheckedChange={(checked) => setAotCacheEnabled(checked === true)}
                disabled={!canEdit}
              />
              <div className="space-y-1">
                <Label htmlFor="aotCacheEnabled" className="text-sm font-normal cursor-pointer">
                  Enable Ahead-of-Time (AOT) caching
                </Label>
                <p className="text-xs text-muted-foreground">
                  Adds <span className="font-mono">-XX:AOTCache=HytaleServer.aot</span> to the Java startup flags.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accept early plugins</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start space-x-2">
              <Checkbox
                id="acceptEarlyPlugins"
                checked={acceptEarlyPlugins}
                onCheckedChange={(checked) => setAcceptEarlyPlugins(checked === true)}
                disabled={!canEdit}
              />
              <div className="space-y-1">
                <Label htmlFor="acceptEarlyPlugins" className="text-sm font-normal cursor-pointer">
                  Accept early plugins
                </Label>
                <p className="text-xs text-muted-foreground">
                  Adds <span className="font-mono">--accept-early-plugins</span> to the server startup arguments.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

