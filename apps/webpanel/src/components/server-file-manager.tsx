import { useState, useEffect, useRef } from "react"
import { Folder, File, Upload, Trash2, Download, RefreshCw, ChevronUp, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; isDirectory: boolean } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  /** Collect files from drop, including nested directories (uses webkitGetAsEntry when available). */
  async function collectFilesFromItems(items: DataTransferItemList): Promise<File[]> {
    const files: File[] = []
    const readEntry = async (entry: FileSystemEntry, basePath = ""): Promise<void> => {
      const path = basePath ? `${basePath}/${entry.name}` : entry.name
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject)
        )
        files.push(new (globalThis as typeof globalThis & { File: typeof File }).File([file], path, { type: file.type }))
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry
        const reader = dirEntry.createReader()
        const read = (): Promise<FileSystemEntry[]> =>
          new Promise((resolve, reject) => reader.readEntries(resolve, reject))
        let entries = await read()
        while (entries.length > 0) {
          for (const e of entries) await readEntry(e, path)
          entries = await read()
        }
      }
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind !== "file") continue
      const entry = "webkitGetAsEntry" in item ? (item as DataTransferItem & { webkitGetAsEntry(): FileSystemEntry | null }).webkitGetAsEntry() : null
      if (entry) {
        await readEntry(entry)
      } else {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    return files
  }

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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const items = e.dataTransfer?.items
    if (!items || items.length === 0) return
    const files = await collectFilesFromItems(items)
    if (files.length === 0) return
    try {
      setUploading(true)
      setError(null)
      await apiClient.uploadServerFiles(serverId, currentPath, files)
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload")
    } finally {
      setUploading(false)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    try {
      setUploading(true)
      setError(null)
      await apiClient.uploadServerFiles(serverId, currentPath, Array.from(files))
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload")
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
      setDeleteConfirm(null)
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
              multiple
              className="hidden"
              onChange={handleUpload}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is a valid HTML attribute for folder selection
              webkitdirectory=""
              className="hidden"
              onChange={handleUpload}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  disabled={uploading || loading}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {uploading ? "Uploading..." : "Upload"}
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || loading}
                >
                  <File className="mr-2 h-4 w-4" />
                  Files... (select multiple)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => folderInputRef.current?.click()}
                  disabled={uploading || loading}
                >
                  <Folder className="mr-2 h-4 w-4" />
                  Folder...
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative rounded-lg border-2 border-dashed transition-colors ${
            isDragging ? "border-primary bg-primary/5" : "border-transparent"
          }`}
        >
          {isDragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80 text-sm font-medium text-muted-foreground">
              Drop files or folders here
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
            <p className="py-8 text-center text-muted-foreground">Loading...</p>
          ) : entries.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">This folder is empty — drag and drop files or folders here</p>
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
                      onClick={() => setDeleteConfirm({ path: entryPath, isDirectory: entry.isDirectory })}
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
        </div>
      </CardContent>

      <Dialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteConfirm?.isDirectory ? "Folder" : "File"}</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                Delete <span className="font-mono font-medium">{deleteConfirm ? (deleteConfirm.path.includes("/") ? deleteConfirm.path.split("/").pop() : deleteConfirm.path) : ""}</span>?
              </span>
              {deleteConfirm?.isDirectory && (
                <span className="block text-destructive font-medium">
                  This folder and all its contents will be permanently deleted.
                </span>
              )}
              <span className="block text-muted-foreground">This cannot be undone.</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm.path)}
            >
              Delete{deleteConfirm?.isDirectory ? " Folder" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
