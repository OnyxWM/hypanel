import type React from "react"

import { useState } from "react"
import { Plus } from "lucide-react"
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

interface CreateServerDialogProps {
  onCreateServer: (data: {
    name: string
    maxMemory: number
    port?: number
    backupEnabled?: boolean
    backupFrequency?: number
    backupMaxCount?: number
    aotCacheEnabled?: boolean
    acceptEarlyPlugins?: boolean
  }) => Promise<void>
}

export function CreateServerDialog({ onCreateServer }: CreateServerDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [maxMemory, setMaxMemory] = useState(4)
  const [port, setPort] = useState(5520)
  const [backupEnabled, setBackupEnabled] = useState(true)
  const [backupFrequency, setBackupFrequency] = useState(30)
  const [backupMaxCount, setBackupMaxCount] = useState(5)
  const [aotCacheEnabled, setAotCacheEnabled] = useState(true)
  const [acceptEarlyPlugins, setAcceptEarlyPlugins] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      await onCreateServer({
        name,
        maxMemory,
        port,
        backupEnabled,
        backupFrequency,
        backupMaxCount,
        aotCacheEnabled,
        acceptEarlyPlugins,
      })
      setOpen(false)
      setName("")
      setMaxMemory(4)
      setPort(5520)
      setBackupEnabled(true)
      setBackupFrequency(30)
      setBackupMaxCount(5)
      setAotCacheEnabled(true)
      setAcceptEarlyPlugins(false)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="shadow-lg shadow-primary/20">
          <Plus className="mr-2 h-4 w-4" />
          New Server
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-popover/80 backdrop-blur-xl border-border/50">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Server</DialogTitle>
            <DialogDescription>Configure your new Hytale server. Click create when you&apos;re done.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto overflow-x-visible px-1">
            <div className="grid gap-2">
              <Label htmlFor="name">Server Name</Label>
              <Input
                id="name"
                placeholder="My Hytale Server"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="bg-secondary/50 backdrop-blur-sm border-border/50"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                placeholder="5520"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value) || 5520)}
                min={1}
                max={65535}
                className="bg-secondary/50 backdrop-blur-sm border-border/50"
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Memory (GB)</Label>
                <span className="text-sm text-muted-foreground">{maxMemory}GB</span>
              </div>
              <Slider value={[maxMemory]} onValueChange={([value]) => setMaxMemory(value)} min={4} max={12} step={1} />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="backupEnabled"
                checked={backupEnabled}
                onCheckedChange={(checked: boolean | "indeterminate") => setBackupEnabled(checked === true)}
              />
              <Label htmlFor="backupEnabled" className="text-sm font-normal cursor-pointer">
                Enable Backups
              </Label>
            </div>
            {backupEnabled && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="backupFrequency">Backup Frequency (minutes)</Label>
                  <Input
                    id="backupFrequency"
                    type="number"
                    min={1}
                    value={backupFrequency}
                    onChange={(e) => setBackupFrequency(Math.max(1, parseInt(e.target.value) || 30))}
                    className="bg-secondary/50 backdrop-blur-sm border-border/50"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="backupMaxCount">Max Backups Stored</Label>
                  <Input
                    id="backupMaxCount"
                    type="number"
                    min={1}
                    value={backupMaxCount}
                    onChange={(e) => setBackupMaxCount(Math.max(1, parseInt(e.target.value) || 5))}
                    className="bg-secondary/50 backdrop-blur-sm border-border/50"
                  />
                </div>
              </>
            )}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="aotCacheEnabled"
                checked={aotCacheEnabled}
                onCheckedChange={(checked: boolean | "indeterminate") => setAotCacheEnabled(checked === true)}
              />
              <Label htmlFor="aotCacheEnabled" className="text-sm font-normal cursor-pointer">
                Enable Ahead-of-Time (AOT) caching
              </Label>
            </div>
            <div className="flex items-start space-x-2">
              <Checkbox
                id="acceptEarlyPlugins"
                checked={acceptEarlyPlugins}
                onCheckedChange={(checked: boolean | "indeterminate") => setAcceptEarlyPlugins(checked === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="acceptEarlyPlugins" className="text-sm font-normal cursor-pointer">
                  Accept early plugins
                </Label>
                <p className="text-xs text-muted-foreground">
                  Adds <span className="font-mono">--accept-early-plugins</span> to the server startup arguments.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="bg-secondary/50 backdrop-blur-sm border-border/50"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !name.trim()} className="shadow-lg shadow-primary/20">
              {isLoading ? "Creating..." : "Create Server"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
