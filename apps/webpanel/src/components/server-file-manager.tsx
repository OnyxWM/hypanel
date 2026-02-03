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

/** File System Access API (Chrome/Edge). getAsFileSystemHandle() must be called synchronously in the drop handler. */
declare global {
  interface DataTransferItem {
    getAsFileSystemHandle?(): Promise<FileSystemHandle | null>
  }
  interface FileSystemHandle {
    readonly kind: "file" | "directory"
    readonly name: string
  }
  interface FileSystemFileHandle extends FileSystemHandle {
    readonly kind: "file"
    getFile(): Promise<File>
  }
  interface FileSystemDirectoryHandle extends FileSystemHandle {
    readonly kind: "directory"
    values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** True if this looks like an unwanted parent (e.g. server ID .json or UUID), not the folder the user selected. */
function isUnwantedLeadingSegment(segment: string): boolean {
  return segment.endsWith(".json") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)
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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [deletingPath, setDeletingPath] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; isDirectory: boolean } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const refreshButtonRef = useRef<HTMLButtonElement | null>(null)
  const deleteTargetPathRef = useRef<string | null>(null)

  /** Collect files from File System Access API handles (must be called after getAsFileSystemHandle() was invoked synchronously in drop). Supports folders. */
  async function collectFilesFromHandles(
    handlePromises: Promise<FileSystemHandle | null>[]
  ): Promise<File[]> {
    const FileCtor = (globalThis as typeof globalThis & { File: typeof File }).File
    const handles = (await Promise.all(handlePromises)).filter(
      (h): h is FileSystemHandle => h != null
    )
    const out: File[] = []

    async function addFilesFromHandle(
      handle: FileSystemFileHandle | FileSystemDirectoryHandle,
      basePath: string
    ): Promise<void> {
      if (handle.kind === "file") {
        const file = await (handle as FileSystemFileHandle).getFile()
        const path = basePath || file.name
        const buf = await file.arrayBuffer()
        out.push(new FileCtor([buf], path, { type: file.type }))
      } else {
        const dir = handle as FileSystemDirectoryHandle
        for await (const entry of dir.values()) {
          const path = basePath ? `${basePath}/${entry.name}` : entry.name
          await addFilesFromHandle(entry, path)
        }
      }
    }

    for (const handle of handles) {
      await addFilesFromHandle(
        handle as FileSystemFileHandle | FileSystemDirectoryHandle,
        handle.name
      )
    }
    return out
  }

  /** Collect files from drop (classic API). Starts all reads synchronously so DataTransfer is not cleared before reads complete. Catches revoked-access errors (NotFoundError) and surfaces a friendly message. */
  async function collectFilesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
    const FileCtor = (globalThis as typeof globalThis & { File: typeof File }).File

    const fileUnavailable = (err: unknown): never => {
      if (err instanceof Error && (err.name === "NotFoundError" || err.name === "NotReadableError")) {
        throw new Error("Dropped files are no longer available. Use the Upload button or drop again.")
      }
      throw err
    }

    const dtFiles = dataTransfer.files
    if (dtFiles && dtFiles.length > 0) {
      const promises = Array.from(dtFiles).map((f) => {
        const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
        return f.arrayBuffer().then((buf) => new FileCtor([buf], path, { type: f.type })).catch(fileUnavailable)
      })
      return Promise.all(promises)
    }
    const items = dataTransfer.items
    if (!items || items.length === 0) return []

    const filePromises: Promise<File>[] = []
    const dirPromises: Promise<File[]>[] = []

    const dirUnavailable = (err: unknown): never => {
      if (err instanceof Error && (err.name === "NotFoundError" || err.name === "NotReadableError")) {
        throw new Error("Dropped folder is no longer available. Use the Upload button or drop again.")
      }
      throw err
    }

    const readDir = (entry: FileSystemDirectoryEntry, basePath: string): Promise<File[]> =>
      new Promise((resolve, reject) => {
        const reader = entry.createReader()
        const allFilePromises: Promise<File>[] = []
        const allDirPromises: Promise<File[]>[] = []

        const processBatch = (entries: FileSystemEntry[]) => {
          for (const e of entries) {
            const path = basePath ? `${basePath}/${e.name}` : e.name
            if (e.isFile) {
              allFilePromises.push(
                new Promise<File>((res, rej) =>
                  (e as FileSystemFileEntry).file((file) => {
                    file.arrayBuffer().then((buf) => res(new FileCtor([buf], path, { type: file.type }))).catch((err) => {
                      try {
                        fileUnavailable(err)
                      } catch (err2) {
                        rej(err2)
                      }
                    })
                  }, rej)
                )
              )
            } else if (e.isDirectory) {
              allDirPromises.push(readDir(e as FileSystemDirectoryEntry, path))
            }
          }
        }

        const readNext = () => {
          reader.readEntries(
            (entries) => {
              try {
                processBatch(entries)
                if (entries.length > 0) {
                  readNext()
                } else {
                  Promise.all([Promise.all(allFilePromises), Promise.all(allDirPromises)])
                    .then(([files, dirFiles]) => resolve([...files, ...dirFiles.flat()]))
                    .catch(reject)
                }
              } catch (err) {
                dirUnavailable(err)
                reject(err)
              }
            },
            (err) => {
              try {
                dirUnavailable(err)
              } catch (e) {
                reject(e)
              }
            }
          )
        }

        readNext()
      })

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind !== "file") continue
      const entry = "webkitGetAsEntry" in item ? (item as DataTransferItem & { webkitGetAsEntry(): FileSystemEntry | null }).webkitGetAsEntry() : null
      if (entry?.isFile) {
        filePromises.push(
          new Promise<File>((resolve, reject) =>
            (entry as FileSystemFileEntry).file((file) => {
              file.arrayBuffer().then((buf) => resolve(new FileCtor([buf], entry.name, { type: file.type }))).catch((err) => {
                try {
                  fileUnavailable(err)
                } catch (e) {
                  reject(e)
                }
              })
            }, reject)
          )
        )
      } else if (entry?.isDirectory) {
        dirPromises.push(readDir(entry as FileSystemDirectoryEntry, entry.name))
      } else {
        const file = item.getAsFile()
        if (file) {
          filePromises.push(
            file.arrayBuffer().then((buf) => new FileCtor([buf], file.name, { type: file.type })).catch(fileUnavailable)
          )
        }
      }
    }

    const singleFiles = await Promise.all(filePromises)
    const dirFiles = await Promise.all(dirPromises)
    return [...singleFiles, ...dirFiles.flat()]
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

  // Keep delete target ref in sync with dialog state so Confirm always has the right path
  useEffect(() => {
    if (deleteConfirm) {
      deleteTargetPathRef.current = deleteConfirm.path
    } else {
      deleteTargetPathRef.current = null
    }
  }, [deleteConfirm])

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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const dt = e.dataTransfer
    if (!dt) return

    const doUpload = async (files: File[]) => {
      if (files.length === 0) return
      try {
        setUploading(true)
        setUploadProgress(0)
        setError(null)
        // Pass each file's path so the backend creates folder structure (e.g. MyFolder/a.txt)
        const pathsToUpload = files.map((f) => f.name.replace(/\\/g, "/"))
        await apiClient.uploadServerFilesWithProgress(
          serverId,
          currentPath,
          files,
          pathsToUpload,
          setUploadProgress
        )
        await loadList()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to upload")
      } finally {
        setUploading(false)
        setUploadProgress(null)
      }
    }

    const onDropError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (
        msg.includes("Dropped files are no longer available") ||
        msg.includes("Dropped folder is no longer available")
      ) {
        setError(
          "Folder drag-and-drop is not supported in this browser. Please use the Upload button and choose \"Folder...\" to upload a folder."
        )
      } else {
        setError(msg || "Failed to read dropped files")
      }
    }

    // File System Access API: getAsFileSystemHandle() must be called synchronously in the drop handler (no await before it). Handles stay valid so folder drops work (Chrome/Edge 86+).
    const useFileSystemAccess =
      typeof DataTransferItem !== "undefined" &&
      "getAsFileSystemHandle" in DataTransferItem.prototype

    if (useFileSystemAccess && dt.items) {
      const handlePromises = [...dt.items]
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFileSystemHandle!())
      queueMicrotask(() => {
        collectFilesFromHandles(handlePromises).then(doUpload).catch(onDropError)
      })
    } else {
      queueMicrotask(() => {
        collectFilesFromDrop(dt).then(doUpload).catch(onDropError)
      })
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const fileList = Array.from(files)
    const hasRelativePaths = fileList.some(
      (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath
    )
    // webkitRelativePath can be "players/file.txt" (selected folder) or "uuid.json/players/file.txt" (browser added parent).
    // Strip a leading segment that looks like UUID or .json so we don't create an extra folder with that name.
    let selectedFolderName = ""
    if (hasRelativePaths && e.target.value) {
      selectedFolderName = e.target.value.replace(/^.*[/\\]/, "").trim() || ""
    }
    if (!selectedFolderName && hasRelativePaths && fileList.length > 0) {
      const firstPath = (fileList[0] as File & { webkitRelativePath?: string }).webkitRelativePath || ""
      const segments = firstPath.split("/").filter(Boolean)
      const firstReal = segments.find((s) => !isUnwantedLeadingSegment(s))
      if (firstReal) selectedFolderName = firstReal
    }
    if (hasRelativePaths && !selectedFolderName) {
      selectedFolderName = "uploaded_folder"
    }
    const pathsToUpload = hasRelativePaths
      ? fileList.map((f) => {
          let relative =
            (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
          const segments = relative.split("/").filter(Boolean)
          if (segments.length > 0 && isUnwantedLeadingSegment(segments[0])) {
            relative = segments.slice(1).join("/")
          }
          return relative.includes("/") ? relative : `${selectedFolderName}/${relative}`
        })
      : undefined
    try {
      setUploading(true)
      setUploadProgress(0)
      setError(null)
      await apiClient.uploadServerFilesWithProgress(
        serverId,
        currentPath,
        fileList,
        pathsToUpload,
        setUploadProgress
      )
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload")
    } finally {
      setUploading(false)
      setUploadProgress(null)
      e.target.value = ""
    }
  }

  const handleDelete = async (fullPath: string) => {
    try {
      setDeletingPath(fullPath)
      setError(null)
      await apiClient.deleteServerFile(serverId, fullPath)
      await loadList()
      setDeleteConfirm(null)
      deleteTargetPathRef.current = null
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete")
      setDeleteConfirm(null)
      deleteTargetPathRef.current = null
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
    <Card className="relative">
      {uploading && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/90"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-lg">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
              <div>
                <p className="font-medium">Uploading files...</p>
                <p className="text-sm text-muted-foreground">
                  Please don&apos;t close or navigate away.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${uploadProgress ?? 0}%` }}
                />
              </div>
              <p className="text-center text-sm text-muted-foreground">
                {uploadProgress ?? 0}%
              </p>
            </div>
          </div>
        </div>
      )}
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Files</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              ref={refreshButtonRef}
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
            <p className="py-8 text-center text-muted-foreground">This folder is empty — drag and drop files here, or use Upload → Folder… for folders</p>
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
                      onClick={() => {
                      deleteTargetPathRef.current = entryPath
                      setDeleteConfirm({ path: entryPath, isDirectory: entry.isDirectory })
                    }}
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
        <DialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            refreshButtonRef.current?.focus()
          }}
        >
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
              type="button"
              variant="destructive"
              disabled={deletingPath !== null}
              onClick={() => {
                if (deletingPath !== null) return
                const path = deleteTargetPathRef.current ?? deleteConfirm?.path
                if (path) handleDelete(path)
              }}
            >
              {deletingPath !== null ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>Delete{deleteConfirm?.isDirectory ? " Folder" : ""}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
