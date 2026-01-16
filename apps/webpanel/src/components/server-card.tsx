import { useState } from "react"
import { Link } from "react-router-dom"
import { Play, Square, RotateCcw, MoreVertical, Users, Cpu, HardDrive, Clock } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { Server } from "@/lib/api"

interface ServerCardProps {
  server: Server
  onStart?: (id: string) => void
  onStop?: (id: string) => void
  onRestart?: (id: string) => void
  onDelete?: (id: string) => void
}

export function ServerCard({ server, onStart, onStop, onRestart, onDelete }: ServerCardProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const handleDelete = async () => {
    if (!onDelete) {
      return
    }
    
    setIsLoading(true)
    try {
      await onDelete(server.id)
      setShowDeleteDialog(false)
    } catch (error) {
      // Error is handled by parent component
    } finally {
      setIsLoading(false)
    }
  }

  const formatUptime = (seconds: number) => {
    if (seconds === 0) return "—"
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    if (days > 0) return `${days}d ${hours}h`
    return `${hours}h`
  }

  const handleAction = async (action: () => void) => {
    setIsLoading(true)
    try {
      await action()
    } finally {
      setIsLoading(false)
    }
  }

  const statusConfig = {
    online: { label: "Online", className: "bg-success/20 text-success border-success/30 backdrop-blur-sm" },
    offline: { label: "Offline", className: "bg-muted/50 text-muted-foreground border-border backdrop-blur-sm" },
    starting: { label: "Starting", className: "bg-warning/20 text-warning border-warning/30 backdrop-blur-sm" },
    stopping: { label: "Stopping", className: "bg-warning/20 text-warning border-warning/30 backdrop-blur-sm" },
  }

  const status = statusConfig[server.status]

  return (
    <Card className="group transition-all hover:border-primary/50 bg-card backdrop-blur-xl border-border/50 hover:shadow-lg hover:shadow-primary/5">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <Link to={`/servers/${server.id}`} className="hover:underline">
            <h3 className="font-semibold leading-none tracking-tight">{server.name}</h3>
          </Link>
          <p className="text-xs text-muted-foreground">
            {server.ip}:{server.port}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("text-xs", status.className)}>
            <span
              className={cn(
                "mr-1.5 h-1.5 w-1.5 rounded-full",
                server.status === "online" && "bg-success",
                server.status === "offline" && "bg-muted-foreground",
                (server.status === "starting" || server.status === "stopping") && "bg-warning animate-pulse",
              )}
            />
            {status.label}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-secondary/50">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover/80 backdrop-blur-xl border-border/50">
              <DropdownMenuItem asChild>
                <Link to={`/servers/${server.id}`}>View Details</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/servers/${server.id}`}>Console</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/servers/${server.id}`}>Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                Delete Server
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary/50 backdrop-blur-sm border border-border/30">
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {server.players}/{server.maxPlayers}
              </p>
              <p className="text-xs text-muted-foreground">Players</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary/50 backdrop-blur-sm border border-border/30">
              <Cpu className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">{server.cpu}%</p>
              <p className="text-xs text-muted-foreground">CPU</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary/50 backdrop-blur-sm border border-border/30">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {server.memory.toFixed(1)}/{server.maxMemory}GB
              </p>
              <p className="text-xs text-muted-foreground">Memory</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary/50 backdrop-blur-sm border border-border/30">
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">{formatUptime(server.uptime)}</p>
              <p className="text-xs text-muted-foreground">Uptime</p>
            </div>
          </div>
        </div>

        {/* Resource Bars */}
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">CPU Usage</span>
              <span className="text-foreground">{server.cpu}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary/30 backdrop-blur-sm">
              <div
                className="h-full bg-chart-1 transition-all shadow-sm shadow-chart-1/50"
                style={{ width: `${server.cpu}%` }}
              />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Memory</span>
              <span className="text-foreground">
                {server.memory.toFixed(1)}GB / {server.maxMemory}GB
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary/30 backdrop-blur-sm">
              <div
                className="h-full bg-chart-2 transition-all shadow-sm shadow-chart-2/50"
                style={{ width: `${(server.memory / server.maxMemory) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {server.status === "offline" ? (
            <Button
              size="sm"
              className="flex-1 shadow-lg shadow-primary/20"
              onClick={() => onStart && handleAction(() => onStart(server.id))}
              disabled={isLoading}
            >
              <Play className="mr-2 h-3 w-3" />
              Start
            </Button>
          ) : server.status === "online" ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 bg-secondary/50 backdrop-blur-sm hover:bg-secondary/70"
                onClick={() => onStop && handleAction(() => onStop(server.id))}
                disabled={isLoading}
              >
                <Square className="mr-2 h-3 w-3" />
                Stop
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="bg-secondary/50 backdrop-blur-sm hover:bg-secondary/70"
                onClick={() => onRestart && handleAction(() => onRestart(server.id))}
                disabled={isLoading}
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" className="flex-1 bg-secondary/50 backdrop-blur-sm" disabled>
              {server.status === "starting" ? "Starting..." : "Stopping..."}
            </Button>
          )}
        </div>
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-popover/80 backdrop-blur-xl border-border/50">
          <DialogHeader>
            <DialogTitle>Delete Server</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{server.name}</strong>? This action cannot be undone and will permanently remove the server configuration and all associated data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleDelete()
              }}
              disabled={isLoading}
            >
              {isLoading ? "Deleting..." : "Delete Server"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
