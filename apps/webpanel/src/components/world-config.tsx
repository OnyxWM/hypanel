import { useState, useEffect } from "react"
import { Save, RefreshCw, AlertCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { apiClient } from "@/lib/api-client"

interface WorldConfigProps {
  serverId: string
  serverStatus: string
  world: string
}

export function WorldConfig({ serverId, serverStatus, world }: WorldConfigProps) {
  const [config, setConfig] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    loadConfig()
  }, [serverId, world])

  const loadConfig = async () => {
    try {
      setIsLoading(true)
      setError(null)
      setSuccess(null)
      const data = await apiClient.getWorldConfig(serverId, world)
      setConfig(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load world config")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!config) return

    try {
      setIsSaving(true)
      setError(null)
      setSuccess(null)

      // Only send safe fields
      const updateData = {
        IsPvpEnabled: config.IsPvpEnabled,
        IsFallDamageEnabled: config.IsFallDamageEnabled,
        IsGameTimePaused: config.IsGameTimePaused,
        IsSpawningNPC: config.IsSpawningNPC,
        Seed: config.Seed,
        SaveNewChunks: config.SaveNewChunks,
        IsUnloadingChunks: config.IsUnloadingChunks,
      }

      await apiClient.updateWorldConfig(serverId, world, updateData)
      setSuccess("World config updated successfully")
      
      // Reload config to get latest state
      await loadConfig()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save world config")
    } finally {
      setIsSaving(false)
    }
  }

  const handleInputChange = (field: string, value: any) => {
    if (!config) return
    setConfig({ ...config, [field]: value })
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">World Config: {world}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted-foreground">Loading world config...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!config) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">World Config: {world}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 py-4 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <p className="text-sm">World config not found</p>
          </div>
          <Button onClick={loadConfig} variant="outline" size="sm">
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Status indicator */}
      {serverStatus === "online" || serverStatus === "starting" ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Server must be stopped to modify world configuration.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Error/Success messages */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-green-200 bg-green-50 text-green-800">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* Config form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">World Config: {world}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Basic Settings */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground">Basic Settings</h3>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">PvP Enabled</label>
                <select
                  className="w-full p-2 border rounded-md bg-background"
                  value={config.IsPvpEnabled ? "true" : "false"}
                  onChange={(e) => handleInputChange("IsPvpEnabled", e.target.value === "true")}
                  disabled={serverStatus === "online" || serverStatus === "starting"}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Fall Damage</label>
                <select
                  className="w-full p-2 border rounded-md bg-background"
                  value={config.IsFallDamageEnabled ? "true" : "false"}
                  onChange={(e) => handleInputChange("IsFallDamageEnabled", e.target.value === "true")}
                  disabled={serverStatus === "online" || serverStatus === "starting"}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Game Time Paused</label>
                <select
                  className="w-full p-2 border rounded-md bg-background"
                  value={config.IsGameTimePaused ? "true" : "false"}
                  onChange={(e) => handleInputChange("IsGameTimePaused", e.target.value === "true")}
                  disabled={serverStatus === "online" || serverStatus === "starting"}
                >
                  <option value="true">Paused</option>
                  <option value="false">Normal</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">NPC Spawning</label>
                <select
                  className="w-full p-2 border rounded-md bg-background"
                  value={config.IsSpawningNPC ? "true" : "false"}
                  onChange={(e) => handleInputChange("IsSpawningNPC", e.target.value === "true")}
                  disabled={serverStatus === "online" || serverStatus === "starting"}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>
            </div>

            {/* World Settings */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground">World Settings</h3>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">World Seed</label>
                <input
                  type="number"
                  className="w-full p-2 border rounded-md bg-background"
                  value={config.Seed || ""}
                  onChange={(e) => handleInputChange("Seed", parseInt(e.target.value) || 0)}
                  disabled={serverStatus === "online" || serverStatus === "starting"}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Save New Chunks</label>
                <select
                  className="w-full p-2 border rounded-md bg-background"
                  value={config.SaveNewChunks ? "true" : "false"}
                  onChange={(e) => handleInputChange("SaveNewChunks", e.target.value === "true")}
                  disabled={serverStatus === "online" || serverStatus === "starting"}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Unload Chunks</label>
                <select
                  className="w-full p-2 border rounded-md bg-background"
                  value={config.IsUnloadingChunks ? "true" : "false"}
                  onChange={(e) => handleInputChange("IsUnloadingChunks", e.target.value === "true")}
                  disabled={serverStatus === "online" || serverStatus === "starting"}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-6 pt-4 border-t">
            <Button
              onClick={handleSave}
              disabled={isSaving || serverStatus === "online" || serverStatus === "starting"}
              className="flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Config
                </>
              )}
            </Button>
            <Button onClick={loadConfig} variant="outline" disabled={isSaving}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reload
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}