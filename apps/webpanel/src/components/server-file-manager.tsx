import { useState, useEffect, useRef } from "react"
import { Folder, File, Upload, Trash2, Download, RefreshCw, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { apiClient } from "@/lib/api-client"
import type { FileEntry } from "@/lib/api"

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

interface ServerFileManagerProps {
  serverId: string
}

export function ServerFileManager({ serverId }: ServerFileManagerProps) {
  const [currentPath, setCurrentPath] = useState("")
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deletingPath, setDeletingPath] = useState<string | null>(null)
  const [deleteConfirmPath, setDeleteConfirmPath] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadList = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await apiClient.getServerFiles(serverId, currentPath)
      setEntries(data.entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files")
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadList()
  }, [serverId, currentPath])

  const goUp = () => {
    const segments = currentPath.split("/").filter(Boolean)
    segments.pop()
    setCurrentPath(segments.join("/"))
  }

  const goInto = (name: string) => {
    setCurrentPath(currentPath ? `${currentPath}/${name}` : name)
  }

  const breadcrumbSegments = currentPath ? currentPath.split("/").filter(Boolean) : []

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setUploading(true)
      setError(null)
      await apiClient.uploadServerFile(serverId, currentPath, file)
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload file")
    } finally {
      setUploading(false)
      e.target.value = ""
    }
  }

  const handleDelete = async (fullPath: string) => {
    try {
      setDeletingPath(fullPath)
      setError(null)
      await apiClient.deleteServerFile(serverId, fullPath)
      setDeleteConfirmPath(null)
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete")
    } finally {
      setDeletingPath(null)
    }
  }

  const handleDownload = async (fullPath: string) => {
    try {
      setError(null)
      await apiClient.downloadServerFile(serverId, fullPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download")
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Files</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadList}
              disabled={loading || uploading}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleUpload}
            />
            <Button
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || loading}
            >
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Breadcrumb */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {currentPath ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-muted-foreground hover:text-foreground"
              onClick={goUp}
            >
              <ChevronUp className="h-4 w-4" />
              Up
            </Button>
          ) : null}
          <button
            type="button"
            className="rounded px-2 py-1 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setCurrentPath("")}
          >
            Server root
          </button>
          {breadcrumbSegments.map((seg, i) => {
            const pathSoFar = breadcrumbSegments.slice(0, i + 1).join("/")
            return (
              <span key={pathSoFar} className="flex items-center gap-2">
                <span className="text-muted-foreground">/</span>
                <button
                  type="button"
                  className="rounded px-2 py-1 font-mono text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setCurrentPath(pathSoFar)}
                >
                  {seg}
                </button>
              </span>
            )
          })}
        </div>

        {/* List */}
        {loading ? (
          <p className="text-center text-muted-foreground">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="text-center text-muted-foreground">This folder is empty</p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => {
              const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name
              const isDeleting = deletingPath === entryPath
              return (
                <div
                  key={entryPath}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {entry.isDirectory ? (
                      <button
                        type="button"
                        className="flex flex-1 items-center gap-3 rounded py-1 text-left hover:bg-muted/50"
                        onClick={() => goInto(entry.name)}
                      >
                        <Folder className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-mono text-sm">{entry.name}</span>
                      </button>
                    ) : (
                      <>
                        <File className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-mono text-sm">{entry.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatBytes(entry.size)}
                        </span>
                      </>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(entry.modified).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!entry.isDirectory && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isDeleting}
                        onClick={() => handleDownload(entryPath)}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isDeleting || (deletingPath !== null && deletingPath !== entryPath)}
                      onClick={() => setDeleteConfirmPath(entryPath)}
                    >
                      {isDeleting ? (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={!!deleteConfirmPath} onOpenChange={(open) => !open && setDeleteConfirmPath(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete</DialogTitle>
            <DialogDescription>
              Delete {deleteConfirmPath ? (deleteConfirmPath.includes("/") ? deleteConfirmPath.split("/").pop() : deleteConfirmPath) : ""}?
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmPath(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmPath && handleDelete(deleteConfirmPath)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
