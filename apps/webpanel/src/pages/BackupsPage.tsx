import { useState, useEffect } from "react"
import { HardDrive, Server, Calendar, FileArchive, Download, Trash2, Folder } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { apiClient } from "@/lib/api-client"

interface BackupItem {
  name: string
  path: string
  size: number
  modified: string
  isDirectory: boolean
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
  const [serverBackups, setServerBackups] = useState<ServerBackups[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadBackups()
  }, [])

  const loadBackups = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await apiClient.getBackups()
      setServerBackups(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load backups")
      console.error("Failed to load backups:", err)
    } finally {
      setIsLoading(false)
    }
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
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <p className="text-muted-foreground">Loading backups...</p>
            </div>
          ) : serverBackups.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No Backups Found</CardTitle>
                <CardDescription>
                  No backup directories have been created yet. Backups will appear here once servers with backups enabled are created.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="space-y-6">
              {serverBackups.map((serverBackup) => (
                <Card key={serverBackup.serverId} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Server className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1">
                        <CardTitle className="text-base">{serverBackup.serverName}</CardTitle>
                        <CardDescription className="flex items-center gap-1 mt-1">
                          <span className="font-mono text-xs">{serverBackup.serverId}</span>
                          <span className="mx-2">•</span>
                          <span>{serverBackup.backups.length} backup{serverBackup.backups.length !== 1 ? "s" : ""}</span>
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {serverBackup.backups.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No backups found for this server</p>
                    ) : (
                      <div className="space-y-3">
                        {serverBackup.backups.map((backup) => (
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
                                <div className="flex items-center gap-2">
                                  <p className="font-medium text-sm truncate">{backup.name}</p>
                                  {backup.isDirectory && (
                                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                                      Directory
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
                                  onClick={() => handleDownload(serverBackup.serverId, backup.name)}
                                  className="gap-2"
                                >
                                  <Download className="h-4 w-4" />
                                  Download
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDelete(serverBackup.serverId, backup.name)}
                                className="gap-2 text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
