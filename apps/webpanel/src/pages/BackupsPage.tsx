import { useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { HardDrive, Calendar, FileArchive, Download, Trash2, Folder } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { apiClient } from "@/lib/api-client"
import type { Server } from "@/lib/api"

interface BackupItem {
  name: string
  path: string
  size: number
  modified: string
  isDirectory: boolean
  backupType?: "official" | "advanced"
}

interface ServerBackups {
  serverId: string
  serverName: string
  backups: BackupItem[]
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

export default function BackupsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [servers, setServers] = useState<Server[]>([])
  const [selectedServer, setSelectedServer] = useState<string>("")
  const [serverBackups, setServerBackups] = useState<ServerBackups[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const requestedServerId = searchParams.get("serverId") || ""

  const loadServers = async () => {
    try {
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
    }
  }

  const loadBackups = async () => {
    try {
      setError(null)
      const data = await apiClient.getBackups()
      setServerBackups(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load backups")
      console.error("Failed to load backups:", err)
    }
  }

  useEffect(() => {
    let done = 0
    const checkDone = () => {
      done++
      if (done === 2) setIsLoading(false)
    }
    setIsLoading(true)
    loadServers().then(checkDone)
    loadBackups().then(checkDone)
  }, [])

  useEffect(() => {
    if (!requestedServerId) return
    if (requestedServerId === selectedServer) return
    if (!servers.some((s) => s.id === requestedServerId)) return
    setSelectedServer(requestedServerId)
  }, [requestedServerId, selectedServer, servers])

  const handleServerChange = (serverId: string) => {
    setSelectedServer(serverId)
    setSearchParams(serverId ? { serverId } : {})
  }

  const handleDelete = async (serverId: string, backupName: string) => {
    if (!confirm(`Are you sure you want to delete "${backupName}"? This action cannot be undone.`)) {
      return
    }

    try {
      await apiClient.deleteBackup(serverId, backupName)
      await loadBackups() // Reload the list
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete backup")
    }
  }

  const handleDownload = (serverId: string, backupName: string) => {
    const url = `/api/servers/backups/${encodeURIComponent(serverId)}/${encodeURIComponent(backupName)}/download`
    window.open(url, "_blank")
  }

  const server = servers.find((s) => s.id === selectedServer)
  const currentServerBackups = serverBackups.find((sb) => sb.serverId === selectedServer)
  const officialBackups = currentServerBackups?.backups.filter((b) => b.backupType !== "advanced") ?? []
  const advancedBackups = currentServerBackups?.backups.filter((b) => b.backupType === "advanced") ?? []

  const renderBackupRow = (backup: BackupItem, serverId: string) => (
    <div
      key={backup.name}
      className="flex flex-col md:flex-row md:items-center md:justify-between rounded-lg border border-border bg-secondary/50 p-4 hover:bg-secondary transition-colors gap-3"
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 shrink-0">
          {backup.isDirectory ? (
            <Folder className="h-4 w-4 text-primary" />
          ) : (
            <FileArchive className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">{backup.name}</p>
            {backup.isDirectory && (
              <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                Directory
              </span>
            )}
            {backup.backupType === "advanced" && (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400">
                Advanced
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 md:gap-4 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <HardDrive className="h-3 w-3" />
              {formatBytes(backup.size)}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {new Date(backup.modified).toLocaleString()}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 md:ml-4">
        {!backup.isDirectory && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDownload(serverId, backup.name)}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Download
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleDelete(serverId, backup.name)}
          className="gap-2 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="pl-0 md:pl-64">
        <Header title="Backups" subtitle="View and manage server backups" />
        <div className="p-4 md:p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
              {error}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 md:gap-4 mb-6">
            <Select
              value={selectedServer}
              onValueChange={handleServerChange}
              disabled={isLoading}
            >
              <SelectTrigger className="w-full md:w-[250px]">
                <SelectValue placeholder={isLoading ? "Loading servers..." : "Select server"} />
              </SelectTrigger>
              <SelectContent>
                {servers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
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
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <p className="text-muted-foreground">Loading backups...</p>
            </div>
          ) : !selectedServer ? (
            <Card>
              <CardHeader>
                <CardTitle>Select a server</CardTitle>
                <CardDescription>
                  Choose a server from the dropdown above to view and manage its backups.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="space-y-6">
              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <CardTitle className="text-base">Official backups</CardTitle>
                  <CardDescription>
                    Standard backups for this server.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {officialBackups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No official backups</p>
                  ) : (
                    <div className="space-y-3">
                      {officialBackups.map((backup) => renderBackupRow(backup, selectedServer))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <CardTitle className="text-base">Advanced backups</CardTitle>
                  <CardDescription>
                    Advanced backups for this server.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {advancedBackups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No advanced backups</p>
                  ) : (
                    <div className="space-y-3">
                      {advancedBackups.map((backup) => renderBackupRow(backup, selectedServer))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
