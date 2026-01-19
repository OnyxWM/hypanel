import { Link, useLocation } from "react-router-dom"
import { LayoutDashboard, Server, Terminal, Settings, Users, HardDrive, Download, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/contexts/sidebar-context"
import { useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"
import type { UpdateCheckResponse } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Servers", href: "/servers", icon: Server },
  { name: "Console", href: "/console", icon: Terminal },
  { name: "Players", href: "/players", icon: Users },
  { name: "Backups", href: "/backups", icon: HardDrive },
  { name: "Settings", href: "/settings", icon: Settings },
]

export function Sidebar() {
  const location = useLocation()
  const pathname = location.pathname
  const { isOpen, close } = useSidebar()
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResponse | null>(null)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)

  // Load dismissed version from localStorage
  useEffect(() => {
    const dismissed = localStorage.getItem("hypanel-update-dismissed")
    if (dismissed) {
      setDismissedVersion(dismissed)
    }
  }, [])

  // Check for updates on mount and periodically
  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    const checkForUpdates = async () => {
      try {
        const result = await apiClient.checkForUpdates()
        if (cancelled) return

        // Handle rate limit errors gracefully
        if (result.error && result.error.includes("Rate limit")) {
          // If rate limited, extend the next check interval
          // Don't show error in sidebar, just log it
          console.warn("Update check rate limited:", result.error)
          if (result.rateLimitReset) {
            const resetTime = new Date(result.rateLimitReset)
            console.log(`Rate limit resets at: ${resetTime.toLocaleString()}`)
          }
          return
        }

        // Only show if update is available and not dismissed for this version
        if (
          result.updateAvailable &&
          result.latestVersion &&
          result.latestVersion !== dismissedVersion
        ) {
          setUpdateInfo(result)
        } else {
          setUpdateInfo(null)
        }
      } catch (error) {
        // Silently fail - don't show errors in sidebar
        // Only log if it's not a rate limit error
        if (!(error instanceof Error && error.message.includes("429"))) {
          console.error("Failed to check for updates:", error)
        }
      }
    }

    // Check immediately
    checkForUpdates()

    // Check every 2 hours (reduced frequency to respect GitHub API rate limits)
    intervalId = setInterval(checkForUpdates, 2 * 60 * 60 * 1000)

    return () => {
      cancelled = true
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [dismissedVersion])

  const handleDismissUpdate = () => {
    if (updateInfo?.latestVersion) {
      localStorage.setItem("hypanel-update-dismissed", updateInfo.latestVersion)
      setDismissedVersion(updateInfo.latestVersion)
      setUpdateInfo(null)
    }
  }

  // Close sidebar when route changes on mobile
  useEffect(() => {
    close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return (
    <>
      {/* Overlay backdrop for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-50 h-screen w-64 border-r border-border bg-sidebar backdrop-blur-xl transition-transform duration-300 ease-in-out",
          // On mobile: show/hide based on isOpen, on desktop: always show
          isOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0"
        )}
      >
        <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center border-b border-sidebar-border px-6">
          <Link to="/" className="flex items-center">
            <img
              src="/newlogo.png"
              alt="Hypanel"
              className="h-10 w-auto max-w-[190px] object-contain drop-shadow-sm"
            />
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navigation.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
            return (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                  isActive
                    ? "bg-sidebar-accent backdrop-blur-sm text-sidebar-primary shadow-sm"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:backdrop-blur-sm hover:text-sidebar-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            )
          })}
        </nav>

        {/* Update Notification */}
        {updateInfo && updateInfo.updateAvailable && (
          <div className="border-t border-sidebar-border px-3 py-3">
            <Card className="border-sidebar-border bg-sidebar-accent/50 backdrop-blur-sm">
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <Download className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-sidebar-foreground mb-1">
                      Update Available
                    </div>
                    <div className="text-xs text-sidebar-foreground/70 mb-2">
                      v{updateInfo.currentVersion} → v{updateInfo.latestVersion}
                    </div>
                    {updateInfo.releaseUrl && (
                      <a
                        href={updateInfo.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline block mb-2"
                      >
                        View release →
                      </a>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDismissUpdate}
                      className="h-6 px-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground"
                    >
                      Dismiss
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDismissUpdate}
                    className="h-6 w-6 p-0 flex-shrink-0 text-sidebar-foreground/60 hover:text-sidebar-foreground"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Support */}
        <div className="border-t border-sidebar-border px-6 py-4">
          <a
            href="https://ko-fi.com/onyxwm"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground"
          >
            Support my work
          </a>
        </div>
      </div>
    </aside>
    </>
  )
}
