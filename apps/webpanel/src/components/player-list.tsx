import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { apiClient } from "@/lib/api-client"
import { Users, Clock, Server, Ban, ShieldCheck, UserX, Loader2, Crown } from "lucide-react"
import type { Player } from "@/lib/api"
import { Link } from "react-router-dom"

interface PlayerListProps {
  players: Player[]
  showServerName?: boolean
  onPlayerClick?: (player: Player) => void
  emptyMessage?: string
}

type PlayerAction = "banlist" | "kick" | "whitelist" | "op"

export function PlayerList({ 
  players, 
  showServerName = false, 
  onPlayerClick,
  emptyMessage = "No players online"
}: PlayerListProps) {
  const [inFlightActionKey, setInFlightActionKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const serverNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of players) map.set(p.serverId, p.serverName)
    return map
  }, [players])

  const formatTimeAgo = (timestamp: string): string => {
    const now = new Date()
    const time = new Date(timestamp)
    const diffMs = now.getTime() - time.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) {
      return "just now"
    } else if (diffMins < 60) {
      return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`
    } else {
      return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`
    }
  }

  const getActionKey = (player: Player, action: PlayerAction) =>
    `${player.serverId}:${player.playerName}:${action}`

  const runPlayerAction = async (player: Player, action: PlayerAction) => {
    const actionKey = getActionKey(player, action)
    const actionLabel =
      action === "banlist"
        ? "ban"
        : action === "kick"
          ? "kick"
          : action === "whitelist"
            ? "whitelist"
            : "op"
    try {
      setActionError(null)
      setInFlightActionKey(actionKey)

      const command =
        action === "banlist"
          ? `/ban ${player.playerName}`
          : action === "kick"
            ? `kick ${player.playerName}`
            : action === "whitelist"
              ? `whitelist add ${player.playerName}`
              : `/op add ${player.playerName}`

      await apiClient.sendCommand(player.serverId, command)
    } catch (err) {
      const serverName = serverNameById.get(player.serverId) || player.serverId
      const message =
        err instanceof Error ? err.message : "Failed to send command"
      setActionError(`Failed to ${actionLabel} ${player.playerName} on ${serverName}: ${message}`)
      // Keep console noise for debugging, but surface a UI error too.
      console.error("Failed to run player action:", err)
    } finally {
      setInFlightActionKey((cur) => (cur === actionKey ? null : cur))
    }
  }

  if (players.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Players
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">{emptyMessage}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Players
          <Badge variant="secondary" className="ml-auto">
            {players.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {actionError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Command failed</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          {players.map((player, index) => (
            <div
              key={`${player.serverId}-${player.playerName}-${index}`}
              className={`
                flex items-center justify-between p-3 rounded-lg border border-border/50
                bg-card/50 backdrop-blur-sm transition-all
                ${onPlayerClick ? "hover:bg-accent/50 cursor-pointer" : ""}
              `}
              onClick={() => onPlayerClick?.(player)}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Users className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{player.playerName}</p>
                  {showServerName && (
                    <div className="flex items-center gap-1 mt-1">
                      <Server className="h-3 w-3 text-muted-foreground" />
                      <Link
                        to={`/servers/${player.serverId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-muted-foreground hover:text-foreground truncate"
                      >
                        {player.serverName}
                      </Link>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  {(
                    [
                      { action: "whitelist" as const, icon: ShieldCheck, label: "Whitelist", variant: "secondary" as const },
                      { action: "op" as const, icon: Crown, label: "Admin", variant: "secondary" as const },
                      { action: "kick" as const, icon: UserX, label: "Kick", variant: "destructive" as const },
                      { action: "banlist" as const, icon: Ban, label: "Banlist", variant: "destructive" as const },
                    ] satisfies Array<{
                      action: PlayerAction
                      icon: typeof ShieldCheck
                      label: string
                      variant: "secondary" | "destructive"
                    }>
                  ).map(({ action, icon: Icon, label, variant }) => {
                    const actionKey = getActionKey(player, action)
                    const isLoading = inFlightActionKey === actionKey
                    const playerPrefix = `${player.serverId}:${player.playerName}:`
                    const isDisabled = Boolean(inFlightActionKey?.startsWith(playerPrefix))
                    const actionClassName =
                      action === "op"
                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                        : ""
                    return (
                      <Button
                        key={action}
                        type="button"
                        size="icon"
                        variant={variant}
                        title={label}
                        aria-label={label}
                        disabled={isDisabled}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (!isDisabled) runPlayerAction(player, action)
                        }}
                        className={`h-8 w-8 min-w-8 p-0 shrink-0 ${actionClassName}`}
                      >
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                      </Button>
                    )
                  })}
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span className="whitespace-nowrap">{formatTimeAgo(player.joinTime)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
