import type React from "react"
import { useState, useCallback } from "react"
import { Upload, Archive, Server as ServerIcon, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { apiClient } from "@/lib/api-client"
import type { Server } from "@/lib/api"

type ImportStep = "choice" | "hytale" | "hypanel"

interface ImportServerDialogProps {
  onImportComplete: (server: Server) => void
}

export function ImportServerDialog({ onImportComplete }: ImportServerDialogProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<ImportStep>("choice")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hytale backup form
  const [hytaleName, setHytaleName] = useState("")
  const [hytalePort, setHytalePort] = useState(5520)
  const [hytaleMaxMemory, setHytaleMaxMemory] = useState(4)
  const [hytaleBackupEnabled, setHytaleBackupEnabled] = useState(true)
  const [hytaleBackupFrequency, setHytaleBackupFrequency] = useState(30)
  const [hytaleBackupMaxCount, setHytaleBackupMaxCount] = useState(5)
  const [hytaleAotCacheEnabled, setHytaleAotCacheEnabled] = useState(true)
  const [hytaleAcceptEarlyPlugins, setHytaleAcceptEarlyPlugins] = useState(false)
  const [hytaleFile, setHytaleFile] = useState<File | null>(null)
  const [hytaleDropActive, setHytaleDropActive] = useState(false)

  // Hypanel backup form
  const [hypanelName, setHypanelName] = useState("")
  const [hypanelPort, setHypanelPort] = useState(5520)
  const [hypanelMaxMemory, setHypanelMaxMemory] = useState(4)
  const [hypanelFile, setHypanelFile] = useState<File | null>(null)
  const [hypanelDropActive, setHypanelDropActive] = useState(false)

  const resetAndClose = useCallback(() => {
    setStep("choice")
    setError(null)
    setHytaleFile(null)
    setHypanelFile(null)
    setHytaleName("")
    setHytalePort(5520)
    setHytaleMaxMemory(4)
    setHypanelName("")
    setHypanelPort(5520)
    setHypanelMaxMemory(4)
    setOpen(false)
  }, [])

  const handleHytaleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setHytaleDropActive(false)
    const file = e.dataTransfer.files[0]
    if (file && file.name.toLowerCase().endsWith(".zip")) setHytaleFile(file)
  }, [])
  const handleHytaleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setHytaleDropActive(true)
  }, [])
  const handleHytaleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setHytaleDropActive(false)
  }, [])
  const handleHytaleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.name.toLowerCase().endsWith(".zip")) setHytaleFile(file)
    e.target.value = ""
  }, [])

  const handleHypanelDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setHypanelDropActive(false)
    const file = e.dataTransfer.files[0]
    if (file && (file.name.toLowerCase().endsWith(".tar.gz") || file.name.toLowerCase().endsWith(".tgz"))) setHypanelFile(file)
  }, [])
  const handleHypanelDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setHypanelDropActive(true)
  }, [])
  const handleHypanelDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setHypanelDropActive(false)
  }, [])
  const handleHypanelFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && (file.name.toLowerCase().endsWith(".tar.gz") || file.name.toLowerCase().endsWith(".tgz"))) setHypanelFile(file)
    e.target.value = ""
  }, [])

  const submitHytale = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!hytaleFile || !hytaleName.trim()) return
    setIsLoading(true)
    try {
      const form = new FormData()
      form.append("backup", hytaleFile)
      form.append("name", hytaleName.trim())
      form.append("port", String(hytalePort))
      form.append("maxMemory", String(hytaleMaxMemory))
      form.append("backupEnabled", hytaleBackupEnabled ? "true" : "false")
      form.append("backupFrequency", String(hytaleBackupFrequency))
      form.append("backupMaxCount", String(hytaleBackupMaxCount))
      form.append("aotCacheEnabled", hytaleAotCacheEnabled ? "true" : "false")
      form.append("acceptEarlyPlugins", hytaleAcceptEarlyPlugins ? "true" : "false")
      const server = await apiClient.importServerFromHytaleBackup(form)
      onImportComplete(server)
      resetAndClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import Hytale backup")
    } finally {
      setIsLoading(false)
    }
  }

  const submitHypanel = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!hypanelFile) return
    const name = hypanelName.trim() || "Imported server"
    setIsLoading(true)
    try {
      const form = new FormData()
      form.append("backup", hypanelFile)
      form.append("name", name)
      form.append("port", String(hypanelPort))
      form.append("maxMemory", String(hypanelMaxMemory))
      const server = await apiClient.importServerFromHypanelBackup(form)
      onImportComplete(server)
      resetAndClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import Hypanel backup")
    } finally {
      setIsLoading(false)
    }
  }

  const renderChoice = () => (
    <div className="space-y-4 py-2">
      <p className="text-sm text-muted-foreground">Choose where your server backup is from.</p>
      <div className="grid gap-3">
        <button
          type="button"
          onClick={() => setStep("hytale")}
          className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Archive className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium">Import from Hytale backup</p>
            <p className="text-sm text-muted-foreground">Official server backup (.zip) from another system or Hytale server</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setStep("hypanel")}
          className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <ServerIcon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium">Import Hypanel server</p>
            <p className="text-sm text-muted-foreground">Advanced backup (.tar.gz) from another Hypanel setup</p>
          </div>
        </button>
      </div>
    </div>
  )

  const renderHytaleForm = () => (
    <form onSubmit={submitHytale} className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="hytale-name">Server Name</Label>
        <Input
          id="hytale-name"
          placeholder="My Hytale Server"
          value={hytaleName}
          onChange={(e) => setHytaleName(e.target.value)}
          required
          className="bg-secondary/50 backdrop-blur-sm border-border/50"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="hytale-port">Port</Label>
        <Input
          id="hytale-port"
          type="number"
          placeholder="5520"
          value={hytalePort}
          onChange={(e) => setHytalePort(parseInt(e.target.value) || 5520)}
          min={1}
          max={65535}
          className="bg-secondary/50 backdrop-blur-sm border-border/50"
        />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label>Memory (GB)</Label>
          <span className="text-sm text-muted-foreground">{hytaleMaxMemory}GB</span>
        </div>
        <Slider value={[hytaleMaxMemory]} onValueChange={([v]) => setHytaleMaxMemory(v)} min={4} max={12} step={1} />
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox
          id="hytale-backupEnabled"
          checked={hytaleBackupEnabled}
          onCheckedChange={(c: boolean | "indeterminate") => setHytaleBackupEnabled(c === true)}
        />
        <Label htmlFor="hytale-backupEnabled" className="text-sm font-normal cursor-pointer">Enable Backups</Label>
      </div>
      {hytaleBackupEnabled && (
        <>
          <div className="grid gap-2">
            <Label htmlFor="hytale-backupFrequency">Backup Frequency (minutes)</Label>
            <Input
              id="hytale-backupFrequency"
              type="number"
              min={1}
              value={hytaleBackupFrequency}
              onChange={(e) => setHytaleBackupFrequency(Math.max(1, parseInt(e.target.value) || 30))}
              className="bg-secondary/50 backdrop-blur-sm border-border/50"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="hytale-backupMaxCount">Max Backups Stored</Label>
            <Input
              id="hytale-backupMaxCount"
              type="number"
              min={1}
              value={hytaleBackupMaxCount}
              onChange={(e) => setHytaleBackupMaxCount(Math.max(1, parseInt(e.target.value) || 5))}
              className="bg-secondary/50 backdrop-blur-sm border-border/50"
            />
          </div>
        </>
      )}
      <div className="flex items-center space-x-2">
        <Checkbox
          id="hytale-aot"
          checked={hytaleAotCacheEnabled}
          onCheckedChange={(c: boolean | "indeterminate") => setHytaleAotCacheEnabled(c === true)}
        />
        <Label htmlFor="hytale-aot" className="text-sm font-normal cursor-pointer">Enable AOT caching</Label>
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox
          id="hytale-early"
          checked={hytaleAcceptEarlyPlugins}
          onCheckedChange={(c: boolean | "indeterminate") => setHytaleAcceptEarlyPlugins(c === true)}
        />
        <Label htmlFor="hytale-early" className="text-sm font-normal cursor-pointer">Accept early plugins</Label>
      </div>
      <div className="grid gap-2">
        <Label>Official server backup (.zip)</Label>
        <div
          onDrop={handleHytaleDrop}
          onDragOver={handleHytaleDragOver}
          onDragLeave={handleHytaleDragLeave}
          className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            hytaleDropActive ? "border-primary bg-primary/5" : "border-border bg-secondary/30"
          }`}
        >
          <input
            type="file"
            accept=".zip"
            onChange={handleHytaleFileInput}
            className="hidden"
            id="hytale-file"
          />
          <label htmlFor="hytale-file" className="cursor-pointer">
            {hytaleFile ? (
              <p className="text-sm font-medium text-foreground">{hytaleFile.name}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Drop official server backup (zip) here or click to browse</p>
            )}
          </label>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => { setStep("choice"); setError(null); }} className="bg-secondary/50">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button type="submit" disabled={isLoading || !hytaleName.trim() || !hytaleFile} className="shadow-lg shadow-primary/20">
          {isLoading ? "Importing..." : "Import Server"}
        </Button>
      </DialogFooter>
    </form>
  )

  const renderHypanelForm = () => (
    <form onSubmit={submitHypanel} className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="hypanel-name">Server Name (optional)</Label>
        <Input
          id="hypanel-name"
          placeholder="Imported server"
          value={hypanelName}
          onChange={(e) => setHypanelName(e.target.value)}
          className="bg-secondary/50 backdrop-blur-sm border-border/50"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="hypanel-port">Port</Label>
        <Input
          id="hypanel-port"
          type="number"
          placeholder="5520"
          value={hypanelPort}
          onChange={(e) => setHypanelPort(parseInt(e.target.value) || 5520)}
          min={1}
          max={65535}
          className="bg-secondary/50 backdrop-blur-sm border-border/50"
        />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label>Memory (GB)</Label>
          <span className="text-sm text-muted-foreground">{hypanelMaxMemory}GB</span>
        </div>
        <Slider value={[hypanelMaxMemory]} onValueChange={([v]) => setHypanelMaxMemory(v)} min={4} max={12} step={1} />
      </div>
      <div className="grid gap-2">
        <Label>Hypanel advanced backup (.tar.gz)</Label>
        <div
          onDrop={handleHypanelDrop}
          onDragOver={handleHypanelDragOver}
          onDragLeave={handleHypanelDragLeave}
          className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            hypanelDropActive ? "border-primary bg-primary/5" : "border-border bg-secondary/30"
          }`}
        >
          <input
            type="file"
            accept=".tar.gz,.tgz"
            onChange={handleHypanelFileInput}
            className="hidden"
            id="hypanel-file"
          />
          <label htmlFor="hypanel-file" className="cursor-pointer">
            {hypanelFile ? (
              <p className="text-sm font-medium text-foreground">{hypanelFile.name}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Drop Hypanel advanced backup (.tar.gz) here or click to browse</p>
            )}
          </label>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => { setStep("choice"); setError(null); }} className="bg-secondary/50">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button type="submit" disabled={isLoading || !hypanelFile} className="shadow-lg shadow-primary/20">
          {isLoading ? "Importing..." : "Import Server"}
        </Button>
      </DialogFooter>
    </form>
  )

  const title = step === "choice" ? "Import Server" : step === "hytale" ? "Import from Hytale backup" : "Import Hypanel server"
  const description = step === "choice"
    ? "Import a server from another system or Hypanel setup."
    : step === "hytale"
      ? "Configure the server and attach the official backup zip. After import, install the server then restore the backup from the Backups page."
      : "Attach the advanced backup and optionally override name, port, and memory."

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) { setStep("choice"); setError(null); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="shadow-sm border-border/50 bg-background/80">
          <Upload className="mr-2 h-4 w-4" />
          Import Server
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-popover/80 backdrop-blur-xl border-border/50">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto overflow-x-visible px-1 py-2">
          {step === "choice" && renderChoice()}
          {step === "hytale" && renderHytaleForm()}
          {step === "hypanel" && renderHypanelForm()}
        </div>
      </DialogContent>
    </Dialog>
  )
}
