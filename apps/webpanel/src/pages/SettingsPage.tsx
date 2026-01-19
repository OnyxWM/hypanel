import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
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
  const [searchParams, setSearchParams] = useSearchParams()
  const [autoScroll, setAutoScroll] = useState(true)
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([])
  const [journalCursor, setJournalCursor] = useState<string | undefined>(undefined)
  const [journalError, setJournalError] = useState<string | null>(null)

  const [stopAllState, setStopAllState] = useState<ActionState>("idle")
  const [restartAllState, setRestartAllState] = useState<ActionState>("idle")
  const [restartDaemonState, setRestartDaemonState] = useState<ActionState>("idle")
  const [checkUpdateState, setCheckUpdateState] = useState<ActionState>("idle")
  const [updateState, setUpdateState] = useState<ActionState>("idle")
  const [updateProgress, setUpdateProgress] = useState<string | null>(null)

  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [lastSummary, setLastSummary] = useState<SystemActionSummary | null>(null)
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResponse | null>(null)
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)
  const [autoUpdateTriggered, setAutoUpdateTriggered] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const journalCursorRef = useRef<string | undefined>(undefined)

  const canRunActions =
    stopAllState === "idle" && restartAllState === "idle" && restartDaemonState === "idle" && checkUpdateState === "idle" && updateState === "idle"

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
    // Load current version on mount
    const loadVersion = async () => {
      try {
        const res = await apiClient.getCurrentVersion()
        setCurrentVersion(res.version)
      } catch (e) {
        console.error("Failed to load version:", e)
      }
    }
    loadVersion()
  }, [])

  // Auto-trigger update if ?update=true is in URL
  useEffect(() => {
    const shouldAutoUpdate = searchParams.get("update") === "true"
    
    if (shouldAutoUpdate && !autoUpdateTriggered && canRunActions) {
      setAutoUpdateTriggered(true)
      // Remove the query parameter from URL
      setSearchParams({})
      
      // First check for updates, then start the update process
      const triggerUpdate = async () => {
        try {
          // Check for updates first
          setCheckUpdateState("running")
          const result = await apiClient.checkForUpdates(true)
          setUpdateCheckResult(result)
          setCheckUpdateState("idle")
          
          // If update is available, start the update process (skip confirmation since user clicked "Update Now")
          if (result.updateAvailable) {
            // Small delay to let the UI update
            setTimeout(() => {
              runUpdateApplication(true)
            }, 500)
          } else {
            setActionError("No update available")
          }
        } catch (e) {
          setCheckUpdateState("idle")
          setActionError(e instanceof Error ? e.message : "Failed to check for updates")
        }
      }
      
      triggerUpdate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, autoUpdateTriggered, canRunActions])

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
      // Force refresh to bypass cache for manual checks
      const result = await apiClient.checkForUpdates(true)
      setUpdateCheckResult(result)
      
      // Build success/error message with rate limit info
      let message = ""
      if (result.error) {
        message = result.error
        if (result.rateLimitReset) {
          const resetTime = new Date(result.rateLimitReset).toLocaleString()
          message += ` (Resets at ${resetTime})`
        }
        setActionError(message)
      } else if (result.updateAvailable) {
        message = `Update available! Current: ${result.currentVersion}, Latest: ${result.latestVersion}`
        if (result.rateLimitRemaining !== undefined) {
          message += ` (${result.rateLimitRemaining} API requests remaining)`
        }
        setActionSuccess(message)
      } else {
        message = `You're up to date! Current version: ${result.currentVersion}`
        if (result.rateLimitRemaining !== undefined) {
          message += ` (${result.rateLimitRemaining} API requests remaining)`
        }
        setActionSuccess(message)
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to check for updates")
    } finally {
      setCheckUpdateState("idle")
    }
  }

  const runUpdateApplication = async (skipConfirmation: boolean = false) => {
    if (!canRunActions) return
    if (!updateCheckResult?.updateAvailable) return
    if (!skipConfirmation && !window.confirm("This will stop all servers, download and install the update, then restart the service. Continue?")) return

    setActionError(null)
    setActionSuccess(null)
    setUpdateProgress(null)
    setUpdateState("running")
    
    try {
      setUpdateProgress("Stopping servers...")
      const result = await apiClient.updateApplication()
      
      if (result.success) {
        setUpdateProgress(null)
        setActionSuccess(result.message || "Update installed successfully! The service will restart shortly. Please refresh the page in a few moments.")
        // Clear update check result since we've updated
        setUpdateCheckResult(null)
        // Optionally refresh after a delay
        setTimeout(() => {
          window.location.reload()
        }, 5000)
      } else {
        setUpdateProgress(null)
        setActionError(result.error || result.message || "Update failed")
      }
    } catch (e) {
      setUpdateProgress(null)
      setActionError(e instanceof Error ? e.message : "Failed to update application")
    } finally {
      setUpdateState("idle")
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
              <CardDescription>
                These actions affect multiple servers or the daemon itself.
                {currentVersion && (
                  <span className="block mt-1 text-xs text-muted-foreground">
                    Current version: v{currentVersion}
                  </span>
                )}
              </CardDescription>
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

                {updateCheckResult && updateCheckResult.updateAvailable && (
                  <Button
                    variant="default"
                    onClick={runUpdateApplication}
                    disabled={!canRunActions}
                    className="md:w-64"
                  >
                    <Download className={cn("h-4 w-4 mr-2", updateState === "running" && "animate-spin")} />
                    {updateState === "running" ? "Updating..." : "Update Application"}
                  </Button>
                )}
              </div>

              {updateProgress && (
                <div className="text-sm text-muted-foreground">
                  {updateProgress}
                </div>
              )}

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

