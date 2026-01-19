import { useEffect, useMemo, useRef, useState } from "react"
import { RotateCcw, Power, RefreshCw, Download } from "lucide-react"

import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import { apiClient } from "@/lib/api-client"
import type { JournalEntry, SystemActionSummary, UpdateCheckResponse } from "@/lib/api"

type ActionState = "idle" | "running"

function formatTime(ts: Date | string | number): string {
  const date =
    ts instanceof Date ? ts : typeof ts === "string" ? new Date(ts) : new Date(ts)
  if (Number.isNaN(date.getTime())) return "Invalid Date"
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export default function SettingsPage() {
  const [autoScroll, setAutoScroll] = useState(true)
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([])
  const [journalCursor, setJournalCursor] = useState<string | undefined>(undefined)
  const [journalError, setJournalError] = useState<string | null>(null)

  const [stopAllState, setStopAllState] = useState<ActionState>("idle")
  const [restartAllState, setRestartAllState] = useState<ActionState>("idle")
  const [restartDaemonState, setRestartDaemonState] = useState<ActionState>("idle")
  const [checkUpdateState, setCheckUpdateState] = useState<ActionState>("idle")

  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [lastSummary, setLastSummary] = useState<SystemActionSummary | null>(null)
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResponse | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const journalCursorRef = useRef<string | undefined>(undefined)

  const canRunActions =
    stopAllState === "idle" && restartAllState === "idle" && restartDaemonState === "idle" && checkUpdateState === "idle"

  useEffect(() => {
    journalCursorRef.current = journalCursor
  }, [journalCursor])

  const summaryText = useMemo(() => {
    if (!lastSummary) return null
    const failedCount = lastSummary.failed?.length || 0
    return `${lastSummary.succeeded.length}/${lastSummary.requested.length} succeeded${
      failedCount ? `, ${failedCount} failed` : ""
    }.`
  }, [lastSummary])

  useEffect(() => {
    if (!autoScroll) return
    if (!scrollRef.current || journalEntries.length === 0) return

    const viewport = scrollRef.current.closest(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLElement | null
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [autoScroll, journalEntries])

  useEffect(() => {
    let cancelled = false

    const loadInitial = async () => {
      try {
        setJournalError(null)
        const res = await apiClient.getSystemJournal({ limit: 200 })
        if (cancelled) return
        setJournalEntries(res.entries)
        setJournalCursor(res.nextCursor)
      } catch (e) {
        if (cancelled) return
        setJournalError(e instanceof Error ? e.message : "Failed to load system logs")
      }
    }

    const poll = async () => {
      try {
        setJournalError(null)
        const res = await apiClient.getSystemJournal({ limit: 200, cursor: journalCursorRef.current })
        if (cancelled) return
        if (res.entries.length > 0) {
          setJournalEntries((prev) => [...prev, ...res.entries].slice(-1000))
          setJournalCursor(res.nextCursor)
        }
      } catch (e) {
        if (cancelled) return
        setJournalError(e instanceof Error ? e.message : "Failed to poll system logs")
      }
    }

    loadInitial()
    const id = setInterval(poll, 2000)

    return () => {
      cancelled = true
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runStopAll = async () => {
    if (!canRunActions) return
    if (!window.confirm("Stop ALL servers? This will stop any running servers.")) return

    setActionError(null)
    setActionSuccess(null)
    setLastSummary(null)
    setStopAllState("running")
    try {
      const res = await apiClient.stopAllServers(false)
      const failedCount = res.failed?.length || 0
      const summary = `${res.succeeded.length}/${res.requested.length} succeeded${
        failedCount ? `, ${failedCount} failed` : ""
      }.`
      setLastSummary(res)
      setActionSuccess(`Stop-all requested. ${summary}`)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to stop all servers")
    } finally {
      setStopAllState("idle")
    }
  }

  const runRestartOnline = async () => {
    if (!canRunActions) return
    if (!window.confirm("Restart ALL servers? Only currently-online servers will be restarted; offline servers stay offline.")) return

    setActionError(null)
    setActionSuccess(null)
    setLastSummary(null)
    setRestartAllState("running")
    try {
      const res = await apiClient.restartOnlineServers()
      const failedCount = res.failed?.length || 0
      const summary = `${res.succeeded.length}/${res.requested.length} succeeded${
        failedCount ? `, ${failedCount} failed` : ""
      }.`
      setLastSummary(res)
      setActionSuccess(`Restart requested. ${summary}`)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to restart online servers")
    } finally {
      setRestartAllState("idle")
    }
  }

  const runRestartDaemon = async () => {
    if (!canRunActions) return
    if (!window.confirm("Restart the Hypanel daemon (systemd service: hypanel)?")) return

    setActionError(null)
    setActionSuccess(null)
    setRestartDaemonState("running")
    try {
      await apiClient.restartDaemon()
      setActionSuccess("Daemon restart queued. The panel may briefly disconnect; refresh if needed.")
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to restart daemon")
    } finally {
      setRestartDaemonState("idle")
    }
  }

  const runCheckForUpdates = async () => {
    if (!canRunActions) return

    setActionError(null)
    setActionSuccess(null)
    setUpdateCheckResult(null)
    setCheckUpdateState("running")
    try {
      const result = await apiClient.checkForUpdates()
      setUpdateCheckResult(result)
      if (result.error) {
        setActionError(result.error)
      } else if (result.updateAvailable) {
        setActionSuccess(`Update available! Current: ${result.currentVersion}, Latest: ${result.latestVersion}`)
      } else {
        setActionSuccess(`You're up to date! Current version: ${result.currentVersion}`)
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to check for updates")
    } finally {
      setCheckUpdateState("idle")
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="pl-0 md:pl-64">
        <Header
          title="Settings"
          subtitle="Manage global actions and view systemd logs for the Hypanel daemon"
        />
        <div className="p-4 md:p-6 space-y-6">
          {actionError && (
            <Alert variant="destructive">
              <AlertTitle>Action failed</AlertTitle>
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}
          {actionSuccess && (
            <Alert variant="success">
              <AlertTitle>Action queued</AlertTitle>
              <AlertDescription>{actionSuccess}</AlertDescription>
            </Alert>
          )}

          <Card className="border-border/50 bg-card/60 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-lg">Global actions</CardTitle>
              <CardDescription>These actions affect multiple servers or the daemon itself.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 md:flex-row">
                <Button
                  variant="destructive"
                  onClick={runStopAll}
                  disabled={!canRunActions}
                  className="md:w-64"
                >
                  <Power className="h-4 w-4 mr-2" />
                  {stopAllState === "running" ? "Stopping..." : "Stop all servers"}
                </Button>

                <Button
                  variant="outline"
                  onClick={runRestartOnline}
                  disabled={!canRunActions}
                  className="md:w-64"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  {restartAllState === "running" ? "Restarting..." : "Restart all servers"}
                </Button>

                <Button
                  variant="secondary"
                  onClick={runRestartDaemon}
                  disabled={!canRunActions}
                  className="md:w-64"
                >
                  <RefreshCw className={cn("h-4 w-4 mr-2", restartDaemonState === "running" && "animate-spin")} />
                  {restartDaemonState === "running" ? "Restarting..." : "Restart daemon"}
                </Button>

                <Button
                  variant="outline"
                  onClick={runCheckForUpdates}
                  disabled={!canRunActions}
                  className="md:w-64"
                >
                  <Download className={cn("h-4 w-4 mr-2", checkUpdateState === "running" && "animate-spin")} />
                  {checkUpdateState === "running" ? "Checking..." : "Check for updates"}
                </Button>
              </div>

              {updateCheckResult && updateCheckResult.updateAvailable && updateCheckResult.releaseUrl && (
                <div className="text-sm">
                  <a
                    href={updateCheckResult.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    View release on GitHub →
                  </a>
                </div>
              )}

              {lastSummary && (
                <div className="text-sm text-muted-foreground">
                  Summary: {summaryText}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60 backdrop-blur-xl">
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-lg">Systemd logs</CardTitle>
                <CardDescription>Live `journalctl -u hypanel` output.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="autoscroll"
                  checked={autoScroll}
                  onCheckedChange={(v) => setAutoScroll(Boolean(v))}
                />
                <Label htmlFor="autoscroll">Auto-scroll</Label>
              </div>
            </CardHeader>
            <CardContent>
              {journalError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertTitle>Log viewer error</AlertTitle>
                  <AlertDescription>{journalError}</AlertDescription>
                </Alert>
              )}

              <div className="h-[420px] rounded-lg border border-border/50 bg-card backdrop-blur-xl overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="space-y-1 font-mono text-sm p-4" ref={scrollRef}>
                    {journalEntries.map((e) => (
                      <div key={e.cursor} className="flex gap-2">
                        <span className="text-muted-foreground whitespace-nowrap">
                          [{formatTime(e.timestamp)}]
                        </span>
                        <span
                          className={cn(
                            e.level === "info" && "text-foreground",
                            e.level === "warning" && "text-warning",
                            e.level === "error" && "text-destructive"
                          )}
                        >
                          {e.message}
                        </span>
                      </div>
                    ))}
                    {journalEntries.length === 0 && (
                      <p className="text-muted-foreground">
                        No journal entries yet (or insufficient permissions to read the system journal).
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>

              <div className="mt-2 text-xs text-muted-foreground">
                Cursor: {journalCursor || "—"} · Showing last {journalEntries.length} lines
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

