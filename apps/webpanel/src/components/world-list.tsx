import { useState, useEffect } from "react"
import { Globe, Settings, AlertCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { apiClient } from "@/lib/api-client"

interface WorldListProps {
  serverId: string
  onWorldSelect: (world: string) => void
  selectedWorld?: string
}

export function WorldList({ serverId, onWorldSelect, selectedWorld }: WorldListProps) {
  const [worlds, setWorlds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadWorlds()
  }, [serverId])

  const loadWorlds = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await apiClient.getWorlds(serverId)
      setWorlds(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load worlds")
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Worlds
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted-foreground">Loading worlds...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Worlds
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 py-4 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <p className="text-sm">{error}</p>
          </div>
          <Button onClick={loadWorlds} variant="outline" size="sm">
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (worlds.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Worlds
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No worlds found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Worlds will appear here once the server has been started and generated world data.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Worlds ({worlds.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {worlds.map((world) => (
            <div
              key={world}
              className={`flex items-center justify-between p-3 rounded-lg border transition-colors cursor-pointer hover:bg-muted/50 ${
                selectedWorld === world ? "bg-muted border-primary" : "border-border"
              }`}
              onClick={() => onWorldSelect(world)}
            >
              <div className="flex items-center gap-3">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{world}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onWorldSelect(world)
                  }}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}