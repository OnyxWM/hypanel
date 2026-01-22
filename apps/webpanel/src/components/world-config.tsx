import { useState, useEffect } from "react"
import { Save, RefreshCw, AlertCircle, Plus, Trash2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiClient } from "@/lib/api-client"

interface WorldConfigProps {
  serverId: string
  serverStatus: string
  world: string
}

interface Box2D {
  Min?: [number, number]
  Max?: [number, number]
}

interface SpawnPoint {
  Position?: [number, number, number]
  Rotation?: [number, number, number]
}

interface SpawnProvider {
  Type?: "Global" | "Individual" | "FitToHeightMap"
  SpawnPoint?: SpawnPoint
  SpawnPoints?: SpawnPoint[]
  SpawnProvider?: SpawnProvider
}

interface WorldConfig {
  UUID?: string
  DisplayName?: string | null
  Version?: number
  IsTicking?: boolean
  IsBlockTicking?: boolean
  IsPvpEnabled?: boolean
  IsFallDamageEnabled?: boolean
  IsGameTimePaused?: boolean
  GameTime?: string
  ForcedWeather?: string | null
  IsSpawningNPC?: boolean
  Seed?: number
  SaveNewChunks?: boolean
  IsUnloadingChunks?: boolean
  GameplayConfig?: string
  GameMode?: string | null
  Death?: Record<string, any> | null
  DaytimeDurationSeconds?: number | null
  NighttimeDurationSeconds?: number | null
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
    Path?: string
  }
  WorldMap?: {
    Type?: string
  }
  ChunkStorage?: {
    Type?: string
  }
  ChunkConfig?: {
    PregenerateRegion?: Box2D | null
    KeepLoadedRegion?: Box2D | null
  }
  SpawnProvider?: SpawnProvider | null
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
        UUID: config.UUID,
        DisplayName: config.DisplayName,
        Version: config.Version,
        IsTicking: config.IsTicking,
        IsBlockTicking: config.IsBlockTicking,
        IsPvpEnabled: config.IsPvpEnabled,
        IsFallDamageEnabled: config.IsFallDamageEnabled,
        IsGameTimePaused: config.IsGameTimePaused,
        GameTime: config.GameTime,
        ForcedWeather: config.ForcedWeather,
        IsSpawningNPC: config.IsSpawningNPC,
        Seed: config.Seed,
        SaveNewChunks: config.SaveNewChunks,
        IsUnloadingChunks: config.IsUnloadingChunks,
        GameplayConfig: config.GameplayConfig,
        GameMode: config.GameMode,
        Death: config.Death,
        DaytimeDurationSeconds: config.DaytimeDurationSeconds,
        NighttimeDurationSeconds: config.NighttimeDurationSeconds,
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
        SpawnProvider: config.SpawnProvider,
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

  const handleChunkConfigChange = (field: "PregenerateRegion" | "KeepLoadedRegion", value: Box2D | null) => {
    if (!config) return
    setConfig({
      ...config,
      ChunkConfig: {
        ...config.ChunkConfig,
        [field]: value,
      },
    })
  }

  const handleBox2DChange = (
    region: Box2D | null | undefined,
    coord: "Min" | "Max",
    index: 0 | 1,
    value: number | undefined
  ): Box2D | null => {
    const newRegion = region || { Min: [0, 0], Max: [0, 0] }
    const newCoord = newRegion[coord] || [0, 0]
    const updatedCoord: [number, number] = [...newCoord] as [number, number]
    updatedCoord[index] = value ?? 0
    return { ...newRegion, [coord]: updatedCoord }
  }

  const handleSpawnProviderChange = (value: SpawnProvider | null) => {
    if (!config) return
    setConfig({ ...config, SpawnProvider: value })
  }

  const handleSpawnPointChange = (
    spawnPoint: SpawnPoint | undefined,
    field: "Position" | "Rotation",
    index: 0 | 1 | 2,
    value: number | undefined
  ): SpawnPoint => {
    const point = spawnPoint || { Position: [0, 0, 0], Rotation: [0, 0, 0] }
    const arr = point[field] || [0, 0, 0]
    const updated: [number, number, number] = [...arr] as [number, number, number]
    updated[index] = value ?? 0
    return { ...point, [field]: updated }
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
        {/* 1. World Identity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">World Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>UUID</Label>
              <Input
                value={config.UUID || ""}
                disabled
                className="bg-muted"
                placeholder="Auto-generated"
              />
              <p className="text-xs text-muted-foreground">Unique identifier for this world</p>
            </div>
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input
                value={config.DisplayName || ""}
                onChange={(e) => handleInputChange("DisplayName", e.target.value || null)}
                disabled={!canEdit}
                placeholder="Player-facing name"
              />
              <p className="text-xs text-muted-foreground">Player-facing name of the world</p>
            </div>
          </CardContent>
        </Card>

        {/* 2. World Generation */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">World Generation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Seed</Label>
              <Input
                type="number"
                value={config.Seed || ""}
                onChange={(e) => handleInputChange("Seed", e.target.value ? parseInt(e.target.value) : undefined)}
                disabled={!canEdit}
                placeholder="Current time"
              />
            </div>
            <div className="space-y-2">
              <Label>World Gen Type</Label>
              <Select
                value={config.WorldGen?.Type || ""}
                onValueChange={(value) => handleNestedChange("WorldGen", "Type", value)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Hytale" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Hytale">Hytale</SelectItem>
                  <SelectItem value="Flat">Flat</SelectItem>
                  <SelectItem value="Void">Void</SelectItem>
                  <SelectItem value="Dummy">Dummy</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {config.WorldGen?.Type === "Hytale" && (
              <>
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
                  <Label>World Gen Path</Label>
                  <Input
                    value={config.WorldGen?.Path || ""}
                    onChange={(e) => handleNestedChange("WorldGen", "Path", e.target.value)}
                    disabled={!canEdit}
                    placeholder="Server default"
                  />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>Chunk Storage Type</Label>
              <Select
                value={config.ChunkStorage?.Type || ""}
                onValueChange={(value) => handleNestedChange("ChunkStorage", "Type", value)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Hytale" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Hytale">Hytale</SelectItem>
                  <SelectItem value="IndexedStorage">IndexedStorage</SelectItem>
                  <SelectItem value="Empty">Empty</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* 3. Chunk Configuration */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Chunk Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-semibold">Pregenerate Region</Label>
                <p className="text-xs text-muted-foreground mb-2">Region to pregenerate when world starts</p>
                <div className="grid gap-4 md:grid-cols-2 border rounded-md p-4">
                  <div>
                    <Label className="text-xs">Min Coordinates [x, z]</Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        type="number"
                        value={config.ChunkConfig?.PregenerateRegion?.Min?.[0] ?? ""}
                        onChange={(e) => {
                          const newRegion = handleBox2DChange(
                            config.ChunkConfig?.PregenerateRegion,
                            "Min",
                            0,
                            e.target.value ? parseInt(e.target.value) : undefined
                          )
                          handleChunkConfigChange("PregenerateRegion", newRegion)
                        }}
                        disabled={!canEdit}
                        placeholder="x1"
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        value={config.ChunkConfig?.PregenerateRegion?.Min?.[1] ?? ""}
                        onChange={(e) => {
                          const newRegion = handleBox2DChange(
                            config.ChunkConfig?.PregenerateRegion,
                            "Min",
                            1,
                            e.target.value ? parseInt(e.target.value) : undefined
                          )
                          handleChunkConfigChange("PregenerateRegion", newRegion)
                        }}
                        disabled={!canEdit}
                        placeholder="z1"
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Max Coordinates [x, z]</Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        type="number"
                        value={config.ChunkConfig?.PregenerateRegion?.Max?.[0] ?? ""}
                        onChange={(e) => {
                          const newRegion = handleBox2DChange(
                            config.ChunkConfig?.PregenerateRegion,
                            "Max",
                            0,
                            e.target.value ? parseInt(e.target.value) : undefined
                          )
                          handleChunkConfigChange("PregenerateRegion", newRegion)
                        }}
                        disabled={!canEdit}
                        placeholder="x2"
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        value={config.ChunkConfig?.PregenerateRegion?.Max?.[1] ?? ""}
                        onChange={(e) => {
                          const newRegion = handleBox2DChange(
                            config.ChunkConfig?.PregenerateRegion,
                            "Max",
                            1,
                            e.target.value ? parseInt(e.target.value) : undefined
                          )
                          handleChunkConfigChange("PregenerateRegion", newRegion)
                        }}
                        disabled={!canEdit}
                        placeholder="z2"
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleChunkConfigChange("PregenerateRegion", null)}
                    disabled={!canEdit}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-sm font-semibold">Keep Loaded Region</Label>
                <p className="text-xs text-muted-foreground mb-2">Region of chunks that will never be unloaded</p>
                <div className="grid gap-4 md:grid-cols-2 border rounded-md p-4">
                  <div>
                    <Label className="text-xs">Min Coordinates [x, z]</Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        type="number"
                        value={config.ChunkConfig?.KeepLoadedRegion?.Min?.[0] ?? ""}
                        onChange={(e) => {
                          const newRegion = handleBox2DChange(
                            config.ChunkConfig?.KeepLoadedRegion,
                            "Min",
                            0,
                            e.target.value ? parseInt(e.target.value) : undefined
                          )
                          handleChunkConfigChange("KeepLoadedRegion", newRegion)
                        }}
                        disabled={!canEdit}
                        placeholder="x1"
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        value={config.ChunkConfig?.KeepLoadedRegion?.Min?.[1] ?? ""}
                        onChange={(e) => {
                          const newRegion = handleBox2DChange(
                            config.ChunkConfig?.KeepLoadedRegion,
                            "Min",
                            1,
                            e.target.value ? parseInt(e.target.value) : undefined
                          )
                          handleChunkConfigChange("KeepLoadedRegion", newRegion)
                        }}
                        disabled={!canEdit}
                        placeholder="z1"
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Max Coordinates [x, z]</Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        type="number"
                        value={config.ChunkConfig?.KeepLoadedRegion?.Max?.[0] ?? ""}
                        onChange={(e) => {
                          const newRegion = handleBox2DChange(
                            config.ChunkConfig?.KeepLoadedRegion,
                            "Max",
                            0,
                            e.target.value ? parseInt(e.target.value) : undefined
                          )
                          handleChunkConfigChange("KeepLoadedRegion", newRegion)
                        }}
                        disabled={!canEdit}
                        placeholder="x2"
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        value={config.ChunkConfig?.KeepLoadedRegion?.Max?.[1] ?? ""}
                        onChange={(e) => {
                          const newRegion = handleBox2DChange(
                            config.ChunkConfig?.KeepLoadedRegion,
                            "Max",
                            1,
                            e.target.value ? parseInt(e.target.value) : undefined
                          )
                          handleChunkConfigChange("KeepLoadedRegion", newRegion)
                        }}
                        disabled={!canEdit}
                        placeholder="z2"
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleChunkConfigChange("KeepLoadedRegion", null)}
                    disabled={!canEdit}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 4. Gameplay Settings */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Gameplay Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Combat & Damage */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Combat & Damage</h4>
              <div className="space-y-4 pl-4 border-l-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={config.IsPvpEnabled || false}
                    onChange={(e) => handleInputChange("IsPvpEnabled", e.target.checked)}
                    disabled={!canEdit}
                    className="rounded border-gray-300"
                  />
                  <Label>PvP Enabled</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={config.IsFallDamageEnabled !== false}
                    onChange={(e) => handleInputChange("IsFallDamageEnabled", e.target.checked)}
                    disabled={!canEdit}
                    className="rounded border-gray-300"
                  />
                  <Label>Fall Damage Enabled</Label>
                </div>
              </div>
            </div>

            {/* Game Mode */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Game Mode</h4>
              <div className="space-y-4 pl-4 border-l-2">
                <div className="space-y-2">
                  <Label>Game Mode</Label>
                  <Select
                    value={config.GameMode || ""}
                    onValueChange={(value) => handleInputChange("GameMode", value === "" ? null : value)}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Inherits from server" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Inherit from server</SelectItem>
                      <SelectItem value="Adventure">Adventure</SelectItem>
                      <SelectItem value="Creative">Creative</SelectItem>
                    </SelectContent>
                  </Select>
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
                <div className="space-y-2">
                  <Label>Daytime Duration (seconds)</Label>
                  <Input
                    type="number"
                    value={config.DaytimeDurationSeconds ?? ""}
                    onChange={(e) => handleInputChange("DaytimeDurationSeconds", e.target.value ? parseInt(e.target.value) : null)}
                    disabled={!canEdit}
                    placeholder="Override daytime duration"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Nighttime Duration (seconds)</Label>
                  <Input
                    type="number"
                    value={config.NighttimeDurationSeconds ?? ""}
                    onChange={(e) => handleInputChange("NighttimeDurationSeconds", e.target.value ? parseInt(e.target.value) : null)}
                    disabled={!canEdit}
                    placeholder="Override nighttime duration"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Death Configuration (JSON)</Label>
                  <textarea
                    value={config.Death ? JSON.stringify(config.Death, null, 2) : ""}
                    onChange={(e) => {
                      try {
                        const parsed = e.target.value ? JSON.parse(e.target.value) : null
                        handleInputChange("Death", parsed)
                      } catch {
                        // Invalid JSON, ignore
                      }
                    }}
                    disabled={!canEdit}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[100px]"
                    placeholder="{}"
                  />
                  <p className="text-xs text-muted-foreground">Inline death configuration overrides (takes precedence over GameplayConfig)</p>
                </div>
              </div>
            </div>

            {/* Time & Weather */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Time & Weather</h4>
              <div className="space-y-4 pl-4 border-l-2">
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
                  <Label>Game Time (ISO-8601)</Label>
                  <Input
                    value={config.GameTime || ""}
                    onChange={(e) => handleInputChange("GameTime", e.target.value)}
                    disabled={!canEdit}
                    placeholder="1970-01-01T05:30:00Z"
                  />
                  <p className="text-xs text-muted-foreground">Current time of day (default: 5:30 AM)</p>
                </div>
                <div className="space-y-2">
                  <Label>Forced Weather</Label>
                  <Input
                    value={config.ForcedWeather || ""}
                    onChange={(e) => handleInputChange("ForcedWeather", e.target.value || null)}
                    disabled={!canEdit}
                    placeholder="Force specific weather type"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 5. Client Effects */}
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

        {/* 6. Tick Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tick Settings</CardTitle>
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
            <p className="text-xs text-muted-foreground">Disable ticking for lobby or hub worlds where dynamic block behavior isn't needed. This improves performance.</p>
          </CardContent>
        </Card>

        {/* 7. Entity & Spawning */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entity & Spawning</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsSpawningNPC !== false}
                onChange={(e) => handleInputChange("IsSpawningNPC", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>NPC Spawning</Label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsSpawnMarkersEnabled !== false}
                onChange={(e) => handleInputChange("IsSpawnMarkersEnabled", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Spawn Markers Enabled</Label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsAllNPCFrozen || false}
                onChange={(e) => handleInputChange("IsAllNPCFrozen", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>All NPC Frozen</Label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsObjectiveMarkersEnabled !== false}
                onChange={(e) => handleInputChange("IsObjectiveMarkersEnabled", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Objective Markers Enabled</Label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.IsCompassUpdating !== false}
                onChange={(e) => handleInputChange("IsCompassUpdating", e.target.checked)}
                disabled={!canEdit}
                className="rounded border-gray-300"
              />
              <Label>Compass Updating</Label>
            </div>
          </CardContent>
        </Card>

        {/* Spawn Provider */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Spawn Provider</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Spawn Provider Type</Label>
              <Select
                value={config.SpawnProvider?.Type || ""}
                onValueChange={(value) => {
                  if (value === "") {
                    handleSpawnProviderChange(null)
                  } else {
                    const newProvider: SpawnProvider = { Type: value as "Global" | "Individual" | "FitToHeightMap" }
                    if (value === "Global") {
                      newProvider.SpawnPoint = { Position: [0, 100, 0], Rotation: [0, 0, 0] }
                    } else if (value === "Individual") {
                      newProvider.SpawnPoints = [{ Position: [0, 100, 0], Rotation: [0, 0, 0] }]
                    } else if (value === "FitToHeightMap") {
                      newProvider.SpawnProvider = { Type: "Global", SpawnPoint: { Position: [0, -1, 0], Rotation: [0, 0, 0] } }
                    }
                    handleSpawnProviderChange(newProvider)
                  }
                }}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  <SelectItem value="Global">Global</SelectItem>
                  <SelectItem value="Individual">Individual</SelectItem>
                  <SelectItem value="FitToHeightMap">FitToHeightMap</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {config.SpawnProvider?.Type === "Global" && config.SpawnProvider.SpawnPoint && (
              <div className="border rounded-md p-4 space-y-4">
                <h5 className="text-sm font-semibold">Spawn Point</h5>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label className="text-xs">Position [x, y, z]</Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        type="number"
                        value={config.SpawnProvider.SpawnPoint.Position?.[0] ?? ""}
                        onChange={(e) => {
                          const updated = handleSpawnPointChange(
                            config.SpawnProvider?.SpawnPoint,
                            "Position",
                            0,
                            e.target.value ? parseFloat(e.target.value) : undefined
                          )
                          handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoint: updated })
                        }}
                        disabled={!canEdit}
                        placeholder="x"
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        value={config.SpawnProvider.SpawnPoint.Position?.[1] ?? ""}
                        onChange={(e) => {
                          const updated = handleSpawnPointChange(
                            config.SpawnProvider?.SpawnPoint,
                            "Position",
                            1,
                            e.target.value ? parseFloat(e.target.value) : undefined
                          )
                          handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoint: updated })
                        }}
                        disabled={!canEdit}
                        placeholder="y"
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        value={config.SpawnProvider.SpawnPoint.Position?.[2] ?? ""}
                        onChange={(e) => {
                          const updated = handleSpawnPointChange(
                            config.SpawnProvider?.SpawnPoint,
                            "Position",
                            2,
                            e.target.value ? parseFloat(e.target.value) : undefined
                          )
                          handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoint: updated })
                        }}
                        disabled={!canEdit}
                        placeholder="z"
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Rotation [x, y, z]</Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        type="number"
                        value={config.SpawnProvider.SpawnPoint.Rotation?.[0] ?? ""}
                        onChange={(e) => {
                          const updated = handleSpawnPointChange(
                            config.SpawnProvider?.SpawnPoint,
                            "Rotation",
                            0,
                            e.target.value ? parseFloat(e.target.value) : undefined
                          )
                          handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoint: updated })
                        }}
                        disabled={!canEdit}
                        placeholder="x"
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        value={config.SpawnProvider.SpawnPoint.Rotation?.[1] ?? ""}
                        onChange={(e) => {
                          const updated = handleSpawnPointChange(
                            config.SpawnProvider?.SpawnPoint,
                            "Rotation",
                            1,
                            e.target.value ? parseFloat(e.target.value) : undefined
                          )
                          handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoint: updated })
                        }}
                        disabled={!canEdit}
                        placeholder="y"
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        value={config.SpawnProvider.SpawnPoint.Rotation?.[2] ?? ""}
                        onChange={(e) => {
                          const updated = handleSpawnPointChange(
                            config.SpawnProvider?.SpawnPoint,
                            "Rotation",
                            2,
                            e.target.value ? parseFloat(e.target.value) : undefined
                          )
                          handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoint: updated })
                        }}
                        disabled={!canEdit}
                        placeholder="z"
                        className="flex-1"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {config.SpawnProvider?.Type === "Individual" && config.SpawnProvider.SpawnPoints && (
              <div className="border rounded-md p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold">Spawn Points</h5>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const points = [...(config.SpawnProvider?.SpawnPoints || [])]
                      points.push({ Position: [0, 100, 0], Rotation: [0, 0, 0] })
                      handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoints: points })
                    }}
                    disabled={!canEdit}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Point
                  </Button>
                </div>
                {config.SpawnProvider.SpawnPoints.map((point, index) => (
                  <div key={index} className="border rounded-md p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Spawn Point {index + 1}</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const points = [...(config.SpawnProvider?.SpawnPoints || [])]
                          points.splice(index, 1)
                          handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoints: points })
                        }}
                        disabled={!canEdit || (config.SpawnProvider?.SpawnPoints?.length ?? 0) === 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label className="text-xs">Position [x, y, z]</Label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            type="number"
                            value={point.Position?.[0] ?? ""}
                            onChange={(e) => {
                              const points = [...(config.SpawnProvider?.SpawnPoints || [])]
                              const updated = handleSpawnPointChange(points[index], "Position", 0, e.target.value ? parseFloat(e.target.value) : undefined)
                              points[index] = updated
                              handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoints: points })
                            }}
                            disabled={!canEdit}
                            placeholder="x"
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            value={point.Position?.[1] ?? ""}
                            onChange={(e) => {
                              const points = [...(config.SpawnProvider?.SpawnPoints || [])]
                              const updated = handleSpawnPointChange(points[index], "Position", 1, e.target.value ? parseFloat(e.target.value) : undefined)
                              points[index] = updated
                              handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoints: points })
                            }}
                            disabled={!canEdit}
                            placeholder="y"
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            value={point.Position?.[2] ?? ""}
                            onChange={(e) => {
                              const points = [...(config.SpawnProvider?.SpawnPoints || [])]
                              const updated = handleSpawnPointChange(points[index], "Position", 2, e.target.value ? parseFloat(e.target.value) : undefined)
                              points[index] = updated
                              handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoints: points })
                            }}
                            disabled={!canEdit}
                            placeholder="z"
                            className="flex-1"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Rotation [x, y, z]</Label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            type="number"
                            value={point.Rotation?.[0] ?? ""}
                            onChange={(e) => {
                              const points = [...(config.SpawnProvider?.SpawnPoints || [])]
                              const updated = handleSpawnPointChange(points[index], "Rotation", 0, e.target.value ? parseFloat(e.target.value) : undefined)
                              points[index] = updated
                              handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoints: points })
                            }}
                            disabled={!canEdit}
                            placeholder="x"
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            value={point.Rotation?.[1] ?? ""}
                            onChange={(e) => {
                              const points = [...(config.SpawnProvider?.SpawnPoints || [])]
                              const updated = handleSpawnPointChange(points[index], "Rotation", 1, e.target.value ? parseFloat(e.target.value) : undefined)
                              points[index] = updated
                              handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoints: points })
                            }}
                            disabled={!canEdit}
                            placeholder="y"
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            value={point.Rotation?.[2] ?? ""}
                            onChange={(e) => {
                              const points = [...(config.SpawnProvider?.SpawnPoints || [])]
                              const updated = handleSpawnPointChange(points[index], "Rotation", 2, e.target.value ? parseFloat(e.target.value) : undefined)
                              points[index] = updated
                              handleSpawnProviderChange({ ...config.SpawnProvider, SpawnPoints: points })
                            }}
                            disabled={!canEdit}
                            placeholder="z"
                            className="flex-1"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {config.SpawnProvider?.Type === "FitToHeightMap" && (
              <div className="border rounded-md p-4 space-y-4">
                <h5 className="text-sm font-semibold">Nested Spawn Provider</h5>
                <div className="space-y-2">
                  <Label>Nested Provider Type</Label>
                  <Select
                    value={config.SpawnProvider.SpawnProvider?.Type || ""}
                    onValueChange={(value) => {
                      const nested: SpawnProvider = { Type: value as "Global" | "Individual" }
                      if (value === "Global") {
                        nested.SpawnPoint = { Position: [0, -1, 0], Rotation: [0, 0, 0] }
                      } else if (value === "Individual") {
                        nested.SpawnPoints = [{ Position: [0, -1, 0], Rotation: [0, 0, 0] }]
                      }
                      handleSpawnProviderChange({ ...config.SpawnProvider, SpawnProvider: nested })
                    }}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Global">Global</SelectItem>
                      <SelectItem value="Individual">Individual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {config.SpawnProvider.SpawnProvider?.Type === "Global" && config.SpawnProvider.SpawnProvider.SpawnPoint && (
                  <div className="pl-4 border-l-2 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label className="text-xs">Position [x, y, z]</Label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            type="number"
                            value={config.SpawnProvider.SpawnProvider.SpawnPoint.Position?.[0] ?? ""}
                            onChange={(e) => {
                              const nested = config.SpawnProvider?.SpawnProvider
                              if (!nested) return
                              const updated = handleSpawnPointChange(nested.SpawnPoint, "Position", 0, e.target.value ? parseFloat(e.target.value) : undefined)
                              handleSpawnProviderChange({ ...config.SpawnProvider, SpawnProvider: { ...nested, SpawnPoint: updated } })
                            }}
                            disabled={!canEdit}
                            placeholder="x"
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            value={config.SpawnProvider.SpawnProvider.SpawnPoint.Position?.[1] ?? ""}
                            onChange={(e) => {
                              const nested = config.SpawnProvider?.SpawnProvider
                              if (!nested) return
                              const updated = handleSpawnPointChange(nested.SpawnPoint, "Position", 1, e.target.value ? parseFloat(e.target.value) : undefined)
                              handleSpawnProviderChange({ ...config.SpawnProvider, SpawnProvider: { ...nested, SpawnPoint: updated } })
                            }}
                            disabled={!canEdit}
                            placeholder="y"
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            value={config.SpawnProvider.SpawnProvider.SpawnPoint.Position?.[2] ?? ""}
                            onChange={(e) => {
                              const nested = config.SpawnProvider?.SpawnProvider
                              if (!nested) return
                              const updated = handleSpawnPointChange(nested.SpawnPoint, "Position", 2, e.target.value ? parseFloat(e.target.value) : undefined)
                              handleSpawnProviderChange({ ...config.SpawnProvider, SpawnProvider: { ...nested, SpawnPoint: updated } })
                            }}
                            disabled={!canEdit}
                            placeholder="z"
                            className="flex-1"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Rotation [x, y, z]</Label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            type="number"
                            value={config.SpawnProvider.SpawnProvider.SpawnPoint.Rotation?.[0] ?? ""}
                            onChange={(e) => {
                              const nested = config.SpawnProvider?.SpawnProvider
                              if (!nested) return
                              const updated = handleSpawnPointChange(nested.SpawnPoint, "Rotation", 0, e.target.value ? parseFloat(e.target.value) : undefined)
                              handleSpawnProviderChange({ ...config.SpawnProvider, SpawnProvider: { ...nested, SpawnPoint: updated } })
                            }}
                            disabled={!canEdit}
                            placeholder="x"
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            value={config.SpawnProvider.SpawnProvider.SpawnPoint.Rotation?.[1] ?? ""}
                            onChange={(e) => {
                              const nested = config.SpawnProvider?.SpawnProvider
                              if (!nested) return
                              const updated = handleSpawnPointChange(nested.SpawnPoint, "Rotation", 1, e.target.value ? parseFloat(e.target.value) : undefined)
                              handleSpawnProviderChange({ ...config.SpawnProvider, SpawnProvider: { ...nested, SpawnPoint: updated } })
                            }}
                            disabled={!canEdit}
                            placeholder="y"
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            value={config.SpawnProvider.SpawnProvider.SpawnPoint.Rotation?.[2] ?? ""}
                            onChange={(e) => {
                              const nested = config.SpawnProvider?.SpawnProvider
                              if (!nested) return
                              const updated = handleSpawnPointChange(nested.SpawnPoint, "Rotation", 2, e.target.value ? parseFloat(e.target.value) : undefined)
                              handleSpawnProviderChange({ ...config.SpawnProvider, SpawnProvider: { ...nested, SpawnPoint: updated } })
                            }}
                            disabled={!canEdit}
                            placeholder="z"
                            className="flex-1"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 8. Persistence */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Persistence</CardTitle>
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
            <div className="space-y-2">
              <Label>Resource Storage Type</Label>
              <Input
                value={config.ResourceStorage?.Type || ""}
                onChange={(e) => handleNestedChange("ResourceStorage", "Type", e.target.value)}
                disabled={!canEdit}
                placeholder="Default"
              />
            </div>
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
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Disabling IsSavingChunks means all world changes are lost on restart. Only use for temporary worlds.
              </AlertDescription>
            </Alert>
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
