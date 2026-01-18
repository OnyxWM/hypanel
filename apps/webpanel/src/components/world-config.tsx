import { useState, useEffect } from "react"
import { Save, RefreshCw, AlertCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { apiClient } from "@/lib/api-client"

interface WorldConfigProps {
  serverId: string
  serverStatus: string
  world: string
}

interface WorldConfig {
  Version?: number
  IsTicking?: boolean
  IsBlockTicking?: boolean
  IsPvpEnabled?: boolean
  IsFallDamageEnabled?: boolean
  IsGameTimePaused?: boolean
  GameTime?: string
  IsSpawningNPC?: boolean
  Seed?: number
  SaveNewChunks?: boolean
  IsUnloadingChunks?: boolean
  GameplayConfig?: string
  ClientEffects?: {
    SunHeightPercent?: number
    SunAngleDegrees?: number
    BloomIntensity?: number
    BloomPower?: number
    SunIntensity?: number
    SunshaftIntensity?: number
    SunshaftScaleFactor?: number
  }
  IsSavingPlayers?: boolean
  IsSavingChunks?: boolean
  IsSpawnMarkersEnabled?: boolean
  IsAllNPCFrozen?: boolean
  IsCompassUpdating?: boolean
  IsObjectiveMarkersEnabled?: boolean
  DeleteOnUniverseStart?: boolean
  DeleteOnRemove?: boolean
  ResourceStorage?: {
    Type?: string
  }
  WorldGen?: {
    Type?: string
    Name?: string
  }
  WorldMap?: {
    Type?: string
  }
  ChunkStorage?: {
    Type?: string
  }
  ChunkConfig?: Record<string, any>
}

export function WorldConfig({ serverId, serverStatus, world }: WorldConfigProps) {
  const [config, setConfig] = useState<WorldConfig | null>(null)
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

      // Send all editable fields
      const updateData: any = {
        Version: config.Version,
        IsTicking: config.IsTicking,
        IsBlockTicking: config.IsBlockTicking,
        IsPvpEnabled: config.IsPvpEnabled,
        IsFallDamageEnabled: config.IsFallDamageEnabled,
        IsGameTimePaused: config.IsGameTimePaused,
        GameTime: config.GameTime,
        IsSpawningNPC: config.IsSpawningNPC,
        Seed: config.Seed,
        SaveNewChunks: config.SaveNewChunks,
        IsUnloadingChunks: config.IsUnloadingChunks,
        GameplayConfig: config.GameplayConfig,
        ClientEffects: config.ClientEffects,
        IsSavingPlayers: config.IsSavingPlayers,
        IsSavingChunks: config.IsSavingChunks,
        IsSpawnMarkersEnabled: config.IsSpawnMarkersEnabled,
        IsAllNPCFrozen: config.IsAllNPCFrozen,
        IsCompassUpdating: config.IsCompassUpdating,
        IsObjectiveMarkersEnabled: config.IsObjectiveMarkersEnabled,
        DeleteOnUniverseStart: config.DeleteOnUniverseStart,
        DeleteOnRemove: config.DeleteOnRemove,
        ResourceStorage: config.ResourceStorage,
        WorldGen: config.WorldGen,
        WorldMap: config.WorldMap,
        ChunkStorage: config.ChunkStorage,
        ChunkConfig: config.ChunkConfig,
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

  const handleNestedChange = (field: string, subField: string, value: any) => {
    if (!config) return
    setConfig({
      ...config,
      [field]: {
        ...(config[field as keyof WorldConfig] as any),
        [subField]: value,
      },
    })
  }

  const canEdit = serverStatus === "offline" || serverStatus === "stopping"

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
      {!canEdit && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Server must be stopped to modify world configuration.
          </AlertDescription>
        </Alert>
      )}

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
      <div className="grid gap-6 md:grid-cols-2">
        {/* Basic Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basic Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Version</Label>
              <Input
                type="number"
                value={config.Version || ""}
                onChange={(e) => handleInputChange("Version", e.target.value ? parseInt(e.target.value) : undefined)}
                disabled={!canEdit}
              />
            </div>

            <div className="space-y-2">
              <Label>PvP Enabled</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={config.IsPvpEnabled ? "true" : "false"}
                onChange={(e) => handleInputChange("IsPvpEnabled", e.target.value === "true")}
                disabled={!canEdit}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Fall Damage</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={config.IsFallDamageEnabled !== false ? "true" : "false"}
                onChange={(e) => handleInputChange("IsFallDamageEnabled", e.target.value === "true")}
                disabled={!canEdit}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>NPC Spawning</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={config.IsSpawningNPC !== false ? "true" : "false"}
                onChange={(e) => handleInputChange("IsSpawningNPC", e.target.value === "true")}
                disabled={!canEdit}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Ticking Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ticking Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsTicking !== false}
                onChange={(e) => handleInputChange("IsTicking", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Is Ticking</Label>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsBlockTicking !== false}
                onChange={(e) => handleInputChange("IsBlockTicking", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Is Block Ticking</Label>
            </div>
          </CardContent>
        </Card>

        {/* Time Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Time Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Game Time (ISO-8601)</Label>
              <Input
                value={config.GameTime || ""}
                onChange={(e) => handleInputChange("GameTime", e.target.value)}
                disabled={!canEdit}
                placeholder="0001-01-01T08:00:00Z"
              />
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsGameTimePaused || false}
                onChange={(e) => handleInputChange("IsGameTimePaused", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Game Time Paused</Label>
            </div>

            <div className="space-y-2">
              <Label>Gameplay Config</Label>
              <Input
                value={config.GameplayConfig || ""}
                onChange={(e) => handleInputChange("GameplayConfig", e.target.value)}
                disabled={!canEdit}
                placeholder="Default"
              />
            </div>
          </CardContent>
        </Card>

        {/* World Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">World Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>World Seed</Label>
              <Input
                type="number"
                value={config.Seed || ""}
                onChange={(e) => handleInputChange("Seed", e.target.value ? parseInt(e.target.value) : undefined)}
                disabled={!canEdit}
              />
            </div>

            <div className="space-y-2">
              <Label>World Gen Type</Label>
              <Input
                value={config.WorldGen?.Type || ""}
                onChange={(e) => handleNestedChange("WorldGen", "Type", e.target.value)}
                disabled={!canEdit}
                placeholder="Hytale"
              />
            </div>

            <div className="space-y-2">
              <Label>World Gen Name</Label>
              <Input
                value={config.WorldGen?.Name || ""}
                onChange={(e) => handleNestedChange("WorldGen", "Name", e.target.value)}
                disabled={!canEdit}
                placeholder="Default"
              />
            </div>

            <div className="space-y-2">
              <Label>World Map Type</Label>
              <Input
                value={config.WorldMap?.Type || ""}
                onChange={(e) => handleNestedChange("WorldMap", "Type", e.target.value)}
                disabled={!canEdit}
                placeholder="WorldGen"
              />
            </div>

            <div className="space-y-2">
              <Label>Chunk Storage Type</Label>
              <Input
                value={config.ChunkStorage?.Type || ""}
                onChange={(e) => handleNestedChange("ChunkStorage", "Type", e.target.value)}
                disabled={!canEdit}
                placeholder="Hytale"
              />
            </div>

            <div className="space-y-2">
              <Label>Resource Storage Type</Label>
              <Input
                value={config.ResourceStorage?.Type || ""}
                onChange={(e) => handleNestedChange("ResourceStorage", "Type", e.target.value)}
                disabled={!canEdit}
                placeholder="Hytale"
              />
            </div>
          </CardContent>
        </Card>

        {/* Saving Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saving Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsSavingPlayers !== false}
                onChange={(e) => handleInputChange("IsSavingPlayers", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Is Saving Players</Label>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsSavingChunks !== false}
                onChange={(e) => handleInputChange("IsSavingChunks", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Is Saving Chunks</Label>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.SaveNewChunks !== false}
                onChange={(e) => handleInputChange("SaveNewChunks", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Save New Chunks</Label>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsUnloadingChunks !== false}
                onChange={(e) => handleInputChange("IsUnloadingChunks", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Is Unloading Chunks</Label>
            </div>
          </CardContent>
        </Card>

        {/* Visual/UI Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Visual/UI Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsSpawnMarkersEnabled !== false}
                onChange={(e) => handleInputChange("IsSpawnMarkersEnabled", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Is Spawn Markers Enabled</Label>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsAllNPCFrozen || false}
                onChange={(e) => handleInputChange("IsAllNPCFrozen", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Is All NPC Frozen</Label>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsCompassUpdating !== false}
                onChange={(e) => handleInputChange("IsCompassUpdating", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Is Compass Updating</Label>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsObjectiveMarkersEnabled !== false}
                onChange={(e) => handleInputChange("IsObjectiveMarkersEnabled", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Is Objective Markers Enabled</Label>
            </div>
          </CardContent>
        </Card>

        {/* Client Effects */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Client Effects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Sun Height Percent</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={config.ClientEffects?.SunHeightPercent ?? ""}
                  onChange={(e) => handleNestedChange("ClientEffects", "SunHeightPercent", e.target.value ? parseFloat(e.target.value) : undefined)}
                  disabled={!canEdit}
                />
              </div>

              <div className="space-y-2">
                <Label>Sun Angle Degrees</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={config.ClientEffects?.SunAngleDegrees ?? ""}
                  onChange={(e) => handleNestedChange("ClientEffects", "SunAngleDegrees", e.target.value ? parseFloat(e.target.value) : undefined)}
                  disabled={!canEdit}
                />
              </div>

              <div className="space-y-2">
                <Label>Bloom Intensity</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={config.ClientEffects?.BloomIntensity ?? ""}
                  onChange={(e) => handleNestedChange("ClientEffects", "BloomIntensity", e.target.value ? parseFloat(e.target.value) : undefined)}
                  disabled={!canEdit}
                />
              </div>

              <div className="space-y-2">
                <Label>Bloom Power</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={config.ClientEffects?.BloomPower ?? ""}
                  onChange={(e) => handleNestedChange("ClientEffects", "BloomPower", e.target.value ? parseFloat(e.target.value) : undefined)}
                  disabled={!canEdit}
                />
              </div>

              <div className="space-y-2">
                <Label>Sun Intensity</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={config.ClientEffects?.SunIntensity ?? ""}
                  onChange={(e) => handleNestedChange("ClientEffects", "SunIntensity", e.target.value ? parseFloat(e.target.value) : undefined)}
                  disabled={!canEdit}
                />
              </div>

              <div className="space-y-2">
                <Label>Sunshaft Intensity</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={config.ClientEffects?.SunshaftIntensity ?? ""}
                  onChange={(e) => handleNestedChange("ClientEffects", "SunshaftIntensity", e.target.value ? parseFloat(e.target.value) : undefined)}
                  disabled={!canEdit}
                />
              </div>

              <div className="space-y-2">
                <Label>Sunshaft Scale Factor</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={config.ClientEffects?.SunshaftScaleFactor ?? ""}
                  onChange={(e) => handleNestedChange("ClientEffects", "SunshaftScaleFactor", e.target.value ? parseFloat(e.target.value) : undefined)}
                  disabled={!canEdit}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Chunk Config */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Chunk Config (JSON - Read Only)</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={JSON.stringify(config.ChunkConfig || {}, null, 2)}
              disabled
              className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm font-mono min-h-[100px]"
            />
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="md:col-span-2 border-destructive">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                These settings can cause permanent data loss. Use with extreme caution.
              </AlertDescription>
            </Alert>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.DeleteOnUniverseStart || false}
                onChange={(e) => handleInputChange("DeleteOnUniverseStart", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Delete on Universe Start</Label>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.DeleteOnRemove || false}
                onChange={(e) => handleInputChange("DeleteOnRemove", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Delete on Remove</Label>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          onClick={handleSave}
          disabled={isSaving || !canEdit}
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
    </div>
  )
}
