import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"

// Get API base URL dynamically from current location
function getApiBaseUrl(): string {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  // In production, use same origin (backend serves the webpanel)
  // In development, fallback to localhost
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  return "http://localhost:3000"
}

const API_BASE_URL = getApiBaseUrl()

type AuthUser = { username: string }

type AuthState =
  | { status: "loading"; user: null }
  | { status: "authenticated"; user: AuthUser }
  | { status: "unauthenticated"; user: null }

type AuthContextValue = {
  state: AuthState
  refresh: () => Promise<void>
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message = body?.error || body?.message || `HTTP ${res.status}`
    throw new Error(message)
  }

  // 204 / empty body support
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T
  }

  const ct = res.headers.get("content-type")
  if (ct && ct.includes("application/json")) {
    return res.json()
  }
  return undefined as T
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null })

  const refresh = useCallback(async () => {
    try {
      const me = await authFetch<{ authenticated: boolean; user: AuthUser }>("/api/auth/me")
      if (me?.authenticated) {
        setState({ status: "authenticated", user: me.user })
      } else {
        setState({ status: "unauthenticated", user: null })
      }
    } catch {
      setState({ status: "unauthenticated", user: null })
    }
  }, [])

  const login = useCallback(
    async (password: string) => {
      await authFetch<{ ok: boolean; user: AuthUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "hypanel", password }),
      })
      await refresh()
    },
    [refresh]
  )

  const logout = useCallback(async () => {
    await authFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" })
    setState({ status: "unauthenticated", user: null })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const value = useMemo<AuthContextValue>(() => ({ state, refresh, login, logout }), [state, refresh, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  const location = useLocation()

  if (state.status === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Checking session...</p>
      </div>
    )
  }

  if (state.status === "unauthenticated") {
    const next = encodeURIComponent(`${location.pathname}${location.search}`)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  return <>{children}</>
}

