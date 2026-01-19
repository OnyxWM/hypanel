import { Link, useLocation } from "react-router-dom"
import { LayoutDashboard, Server, Terminal, Settings, Users, HardDrive } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/contexts/sidebar-context"
import { useEffect } from "react"

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
