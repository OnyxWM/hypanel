import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Send } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { ConsoleLog } from "@/lib/api"

interface ServerConsoleProps {
  logs: ConsoleLog[]
  onSendCommand: (command: string) => void
  isLoading?: boolean
}

export function ServerConsole({ logs, onSendCommand, isLoading }: ServerConsoleProps) {
  const [command, setCommand] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (command.trim()) {
      onSendCommand(command)
      setCommand("")
    }
  }

  const formatTime = (timestamp: Date) => {
    return timestamp.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-border/50 bg-card backdrop-blur-xl overflow-hidden">
      {/* Console Output */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-1 font-mono text-sm" ref={scrollRef}>
          {logs.map((log) => (
            <div key={log.id} className="flex gap-2">
              <span className="text-muted-foreground">[{formatTime(log.timestamp)}]</span>
              <span
                className={cn(
                  log.level === "info" && "text-foreground",
                  log.level === "warning" && "text-warning",
                  log.level === "error" && "text-destructive",
                )}
              >
                {log.message}
              </span>
            </div>
          ))}
          {logs.length === 0 && (
            <p className="text-muted-foreground">No logs available. Start the server to see output.</p>
          )}
        </div>
      </ScrollArea>

      {/* Command Input */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 border-t border-border/50 p-4 bg-secondary/20 backdrop-blur-sm"
      >
        <Input
          placeholder="Enter command..."
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          className="flex-1 bg-secondary/50 backdrop-blur-sm font-mono border-border/50"
          disabled={isLoading}
        />
        <Button
          type="submit"
          size="icon"
          disabled={isLoading || !command.trim()}
          className="shadow-lg shadow-primary/20"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  )
}
