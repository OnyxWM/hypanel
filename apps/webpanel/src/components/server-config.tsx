import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, Save, RefreshCw } from "lucide-react"
import { apiClient } from "@/lib/api-client"

interface HytaleConfig {
  ServerName?: string
  MOTD?: string
  Password?: string
  MaxPlayers?: number
  MaxViewRadius?: number
  LocalCompressionEnabled?: boolean
  Defaults?: {
    World?: string
    GameMode?: "survival" | "creative" | "adventure" | "spectator"
  }
}

interface ServerConfigProps {
  serverId: string
  serverStatus: string
}

export function ServerConfig({ serverId, serverStatus }: ServerConfigProps) {
  const [config, setConfig] = useState<HytaleConfig | null>(null)
  const [originalConfig, setOriginalConfig] = useState<HytaleConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [serverId])

  const loadConfig = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await apiClient.getServerConfig(serverId)
      setConfig(data)
      setOriginalConfig(data)
      setSuccess(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!config) return

    try {
      setIsSaving(true)
      setError(null)
      setSuccess(false)
      
      await apiClient.updateServerConfig(serverId, config)
      setOriginalConfig(config)
      setSuccess(true)
      
      // Hide success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save config")
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    if (originalConfig) {
      setConfig({ ...originalConfig })
      setError(null)
      setSuccess(false)
    }
  }

  const hasChanges = JSON.stringify(config) !== JSON.stringify(originalConfig)
  const canEdit = serverStatus === "offline" || serverStatus === "stopping"

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="ml-2">Loading config...</span>
      </div>
    )
  }

  if (error && !config) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (!config) {
    return (
      <div className="text-center p-8 text-muted-foreground">
        No config file found
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Status Messages */}
      {!canEdit && (
        <Alert variant="destructive">
          <AlertDescription>
            Server must be stopped before editing configuration. Stop the server first to make changes.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-success bg-success/10">
          <AlertDescription className="text-success">
            Config updated successfully!
          </AlertDescription>
        </Alert>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Server Configuration</h3>
          <p className="text-sm text-muted-foreground">
            Edit your Hytale server's config.json file
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={!hasChanges || isSaving}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Reset
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || !canEdit || isSaving}
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Changes
          </Button>
        </div>
      </div>

      {/* Config Form */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basic Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="serverName">Server Name</Label>
              <Input
                id="serverName"
                value={config.ServerName || ""}
                onChange={(e) => setConfig({ ...config, ServerName: e.target.value })}
                disabled={!canEdit}
                placeholder="My Hytale Server"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="motd">Message of the Day (MOTD)</Label>
              <Input
                id="motd"
                value={config.MOTD || ""}
                onChange={(e) => setConfig({ ...config, MOTD: e.target.value })}
                disabled={!canEdit}
                placeholder="Welcome to my server!"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Server Password (optional)</Label>
              <Input
                id="password"
                type="password"
                value={config.Password || ""}
                onChange={(e) => setConfig({ ...config, Password: e.target.value })}
                disabled={!canEdit}
                placeholder="Leave empty for no password"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Game Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="maxPlayers">Max Players</Label>
              <Input
                id="maxPlayers"
                type="number"
                min="1"
                max="1000"
                value={config.MaxPlayers || 20}
                onChange={(e) => setConfig({ ...config, MaxPlayers: parseInt(e.target.value) || 20 })}
                disabled={!canEdit}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxViewRadius">Max View Radius</Label>
              <Input
                id="maxViewRadius"
                type="number"
                min="1"
                max="32"
                value={config.MaxViewRadius || 10}
                onChange={(e) => setConfig({ ...config, MaxViewRadius: parseInt(e.target.value) || 10 })}
                disabled={!canEdit}
              />
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="compression"
                checked={config.LocalCompressionEnabled !== false}
                onChange={(e) => setConfig({ ...config, LocalCompressionEnabled: e.target.checked })}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label htmlFor="compression">Enable Local Compression</Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Default World</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="world">Default World</Label>
              <Input
                id="world"
                value={config.Defaults?.World || ""}
                onChange={(e) => setConfig({ 
                  ...config, 
                  Defaults: { ...config.Defaults, World: e.target.value } 
                })}
                disabled={!canEdit}
                placeholder="world"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gameMode">Default Game Mode</Label>
              <select
                id="gameMode"
                value={config.Defaults?.GameMode || "survival"}
                onChange={(e) => setConfig({ 
                  ...config, 
                  Defaults: { ...config.Defaults, GameMode: e.target.value as any } 
                })}
                disabled={!canEdit}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="survival">Survival</option>
                <option value="creative">Creative</option>
                <option value="adventure">Adventure</option>
                <option value="spectator">Spectator</option>
              </select>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}