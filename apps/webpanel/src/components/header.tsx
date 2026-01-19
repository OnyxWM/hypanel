import { Bell, User, ShieldCheck, Check, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AuthModal } from "./auth-modal"
import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { apiClient, wsClient } from "@/lib/api-client"
import type { Notification } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSidebar } from "@/contexts/sidebar-context"

interface HeaderProps {
  title: string
  subtitle?: string
}

export function Header({ title, subtitle }: HeaderProps) {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { toggle } = useSidebar()
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authData, setAuthData] = useState<{ url: string; code: string } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [lastReadAt, setLastReadAt] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("hypanel.notifications.lastReadAt")
      const parsed = raw ? Number.parseInt(raw, 10) : 0
      return Number.isFinite(parsed) ? parsed : 0
    } catch {
      return 0
    }
  })

  const unreadCount = notifications.filter((n) => {
    const ts = Date.parse(n.createdAt)
    return Number.isFinite(ts) && ts > lastReadAt
  }).length

  const formatRelativeTime = (createdAt: string): string => {
    const ts = Date.parse(createdAt)
    if (!Number.isFinite(ts)) return ""
    const diffMs = Date.now() - ts
    const diffSec = Math.max(0, Math.floor(diffMs / 1000))
    if (diffSec < 60) return `${diffSec}s ago`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = Math.floor(diffHr / 24)
    return `${diffDay}d ago`
  }

  // Check authentication status on mount and periodically
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const statusData = await apiClient.getDownloaderAuthStatus()
        setIsAuthenticated(statusData.authenticated)
      } catch (error) {
        console.error("Failed to check auth status:", error)
      }
    }

    // Check immediately
    checkAuthStatus()

    // Check every 5 seconds
    const intervalId = setInterval(checkAuthStatus, 5000)

    return () => clearInterval(intervalId)
  }, [])

  // Notifications (persisted via backend; unread tracked locally)
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const data = await apiClient.getNotifications(50)
        if (!cancelled) setNotifications(data)
      } catch (error) {
        console.error("Failed to load notifications:", error)
      }
    }

    load()

    // Ensure websocket is connected so we receive real-time notifications
    wsClient.connect()

    const handleNotification = (data: any) => {
      const n = data?.notification as Notification | undefined
      if (!n || !n.id) return
      setNotifications((prev) => {
        if (prev.some((x) => x.id === n.id)) return prev
        return [n, ...prev].slice(0, 50)
      })
    }

    wsClient.on("notification", handleNotification)

    return () => {
      cancelled = true
      wsClient.off("notification", handleNotification)
    }
  }, [])

  const markAllNotificationsRead = () => {
    const now = Date.now()
    setLastReadAt(now)
    try {
      localStorage.setItem("hypanel.notifications.lastReadAt", String(now))
    } catch {
      // ignore storage errors
    }
  }

  const handleClearNotifications = async () => {
    try {
      await apiClient.clearNotifications()
      setNotifications([])
      markAllNotificationsRead()
    } catch (error) {
      console.error("Failed to clear notifications:", error)
    }
  }

  // Re-check auth status when modal closes
  const handleModalClose = () => {
    setAuthModalOpen(false)
    setAuthData(null)
    // Re-check auth status after modal closes
    setTimeout(async () => {
      try {
        const statusData = await apiClient.getDownloaderAuthStatus()
        setIsAuthenticated(statusData.authenticated)
      } catch (error) {
        console.error("Failed to check auth status:", error)
      }
    }, 500)
  }

  const handleAuthClick = async () => {
    if (isAuthenticated) {
      // If already authenticated, maybe show info or allow re-auth
      return
    }
    setIsLoading(true)
    try {
      const data = await apiClient.startDownloaderAuth()
      setAuthData(data)
      setAuthModalOpen(true)
    } catch (error) {
      console.error("Failed to start auth:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignOut = async () => {
    try {
      await logout()
    } catch (error) {
      console.error("Failed to sign out:", error)
    } finally {
      wsClient.disconnect()
      navigate("/login", { replace: true })
    }
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/60 px-4 md:px-6 backdrop-blur-xl">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Hamburger menu button for mobile */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden h-9 w-9 shrink-0"
            onClick={toggle}
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-base md:text-lg font-semibold text-foreground truncate">{title}</h1>
            {subtitle && <p className="text-xs md:text-sm text-muted-foreground truncate">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
          <Button
            variant={isAuthenticated ? "default" : "outline"}
            size="sm"
            onClick={handleAuthClick}
            disabled={isLoading || isAuthenticated}
            className={`hidden md:flex items-center gap-2 ${
              isAuthenticated
                ? "bg-green-600 hover:bg-green-700 text-white border-green-600"
                : "bg-secondary/50 backdrop-blur-sm border-border/50 hover:bg-secondary/70"
            }`}
          >
            {isAuthenticated ? (
              <>
                <Check className="h-4 w-4" />
                Authorized
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                {isLoading ? "Starting..." : "Auth Downloader"}
              </>
            )}
          </Button>

          <DropdownMenu
            onOpenChange={(open) => {
              if (open) markAllNotificationsRead()
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative hover:bg-secondary/50 hover:backdrop-blur-sm">
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground shadow-lg shadow-primary/25">
                    {Math.min(unreadCount, 99)}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] md:w-96 bg-popover/80 backdrop-blur-xl border-border/50">
              <div className="flex items-center justify-between px-2 py-1.5">
                <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={handleClearNotifications}
                  disabled={notifications.length === 0}
                >
                  Clear
                </Button>
              </div>
              <DropdownMenuSeparator />

              {notifications.length === 0 ? (
                <div className="px-2 py-3 text-sm text-muted-foreground">No notifications yet</div>
              ) : (
                <div className="max-h-80 overflow-auto">
                  {notifications.map((n) => (
                    <DropdownMenuItem
                      key={n.id}
                      className="flex flex-col items-start gap-0.5 py-2"
                      onSelect={(e) => e.preventDefault()}
                    >
                      <div className="flex w-full items-center justify-between gap-3">
                        <div className="font-medium text-foreground">
                          {n.title}
                          {n.serverName ? <span className="text-muted-foreground"> · {n.serverName}</span> : null}
                        </div>
                        <div className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(n.createdAt)}</div>
                      </div>
                      <div className="w-full text-xs text-muted-foreground line-clamp-2">{n.message}</div>
                    </DropdownMenuItem>
                  ))}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full hover:bg-secondary/50 hover:backdrop-blur-sm">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary/80 backdrop-blur-sm border border-border/50">
                  <User className="h-4 w-4" />
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-popover/80 backdrop-blur-xl border-border/50">
              <DropdownMenuItem className="text-destructive" onSelect={handleSignOut}>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {authData && (
        <AuthModal
          open={authModalOpen}
          onClose={handleModalClose}
          url={authData.url}
          code={authData.code}
        />
      )}
    </>
  )
}
