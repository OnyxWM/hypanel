import { useState, useEffect } from "react"
import { Search, Users } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { PlayerList } from "@/components/player-list"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { apiClient, wsClient } from "@/lib/api-client"
import type { Player } from "@/lib/api"

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([])
  const [filteredPlayers, setFilteredPlayers] = useState<Player[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadPlayers()
    
    // Set up WebSocket for real-time updates
    wsClient.connect()
    
    const handlePlayerJoin = () => {
      loadPlayers()
    }
    
    const handlePlayerLeave = () => {
      loadPlayers()
    }

    wsClient.on("player:join", handlePlayerJoin)
    wsClient.on("player:leave", handlePlayerLeave)

    return () => {
      wsClient.off("player:join", handlePlayerJoin)
      wsClient.off("player:leave", handlePlayerLeave)
    }
  }, [])

  useEffect(() => {
    // Filter players based on search query
    if (!searchQuery.trim()) {
      setFilteredPlayers(players)
      return
    }

    const query = searchQuery.toLowerCase()
    const filtered = players.filter(
      (player) =>
        player.playerName.toLowerCase().includes(query) ||
        player.serverName.toLowerCase().includes(query)
    )
    setFilteredPlayers(filtered)
  }, [searchQuery, players])

  const loadPlayers = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await apiClient.getAllPlayers()
      setPlayers(data)
      setFilteredPlayers(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load players")
      console.error("Failed to load players:", err)
    } finally {
      setIsLoading(false)
    }
  }

  // Group players by server
  const playersByServer = filteredPlayers.reduce((acc, player) => {
    if (!acc[player.serverId]) {
      acc[player.serverId] = {
        serverName: player.serverName,
        players: [],
      }
    }
    acc[player.serverId].players.push(player)
    return acc
  }, {} as Record<string, { serverName: string; players: Player[] }>)

  const serverGroups = Object.entries(playersByServer).sort((a, b) => 
    b[1].players.length - a[1].players.length
  )

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="pl-0 md:pl-64">
        <Header 
          title="Players" 
          subtitle={`${players.length} player${players.length !== 1 ? "s" : ""} online across all servers`} 
        />
        <div className="p-4 md:p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
              {error}
            </div>
          )}

          {/* Search Bar */}
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search players or servers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <p className="text-muted-foreground">Loading players...</p>
            </div>
          ) : filteredPlayers.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Users className="h-16 w-16 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground text-lg">
                  {searchQuery ? "No players match your search" : "No players online"}
                </p>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="mt-2 text-sm text-primary hover:underline"
                  >
                    Clear search
                  </button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* All Players View */}
              <PlayerList 
                players={filteredPlayers} 
                showServerName={true}
                emptyMessage="No players match your search"
              />

              {/* Grouped by Server (Optional - can be toggled) */}
              {serverGroups.length > 1 && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">Players by Server</h2>
                  {serverGroups.map(([serverId, group]) => (
                    <div key={serverId} className="space-y-2">
                      <h3 className="text-sm font-medium text-muted-foreground">
                        {group.serverName} ({group.players.length})
                      </h3>
                      <PlayerList 
                        players={group.players} 
                        showServerName={false}
                        emptyMessage=""
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
