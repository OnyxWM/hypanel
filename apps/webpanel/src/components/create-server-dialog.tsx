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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"

interface CreateServerDialogProps {
  onCreateServer: (data: {
    name: string
    jarFile?: string
    assetsPath?: string
    maxPlayers: number
    maxMemory: number
    version?: string
    port?: number
    sessionToken?: string
    identityToken?: string
  }) => Promise<void>
}

export function CreateServerDialog({ onCreateServer }: CreateServerDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [jarFile, setJarFile] = useState("HytaleServer.jar")
  const [maxPlayers, setMaxPlayers] = useState(20)
  const [maxMemory, setMaxMemory] = useState(4)
  const [port, setPort] = useState(5520)
  const [version, setVersion] = useState("1.0.0-beta")
  const [sessionToken, setSessionToken] = useState("")
  const [identityToken, setIdentityToken] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const serverPath = `~/hytale/${name.toLowerCase().replace(/\s+/g, "-")}`
  const assetsPath = `${serverPath}/Assets.zip`

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      await onCreateServer({
        name,
        jarFile,
        assetsPath,
        maxPlayers,
        maxMemory,
        version,
        port,
        sessionToken: sessionToken || undefined,
        identityToken: identityToken || undefined,
      })
      setOpen(false)
      setName("")
      setJarFile("HytaleServer.jar")
      setMaxPlayers(20)
      setMaxMemory(4)
      setPort(5520)
      setVersion("1.0.0-beta")
      setSessionToken("")
      setIdentityToken("")
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
          <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto">
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
              <Label htmlFor="jarFile">JAR File</Label>
              <Input
                id="jarFile"
                placeholder="HytaleServer.jar"
                value={jarFile}
                onChange={(e) => setJarFile(e.target.value)}
                className="bg-secondary/50 backdrop-blur-sm border-border/50"
              />
            </div>
            <div className="text-xs text-muted-foreground px-1">
              Server will be created at: {serverPath || "~/hytale/..."}
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
              <Label htmlFor="version">Version</Label>
              <Select value={version} onValueChange={setVersion}>
                <SelectTrigger className="bg-secondary/50 backdrop-blur-sm border-border/50">
                  <SelectValue placeholder="Select version" />
                </SelectTrigger>
                <SelectContent className="bg-popover/80 backdrop-blur-xl border-border/50">
                  <SelectItem value="1.0.0-beta">1.0.0-beta (Latest)</SelectItem>
                  <SelectItem value="0.9.0-beta">0.9.0-beta</SelectItem>
                  <SelectItem value="0.8.0-beta">0.8.0-beta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Max Players</Label>
                <span className="text-sm text-muted-foreground">{maxPlayers}</span>
              </div>
              <Slider
                value={[maxPlayers]}
                onValueChange={([value]) => setMaxPlayers(value)}
                min={5}
                max={100}
                step={5}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Memory (GB)</Label>
                <span className="text-sm text-muted-foreground">{maxMemory}GB</span>
              </div>
              <Slider value={[maxMemory]} onValueChange={([value]) => setMaxMemory(value)} min={1} max={16} step={1} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sessionToken">Session Token (Optional)</Label>
              <Input
                id="sessionToken"
                type="password"
                placeholder="Leave empty for interactive auth"
                value={sessionToken}
                onChange={(e) => setSessionToken(e.target.value)}
                className="bg-secondary/50 backdrop-blur-sm border-border/50"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="identityToken">Identity Token (Optional)</Label>
              <Input
                id="identityToken"
                type="password"
                placeholder="Leave empty for interactive auth"
                value={identityToken}
                onChange={(e) => setIdentityToken(e.target.value)}
                className="bg-secondary/50 backdrop-blur-sm border-border/50"
              />
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
