import { createContext, useContext, useState, useCallback } from "react"
import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"

interface AppUpdateContextType {
  inProgress: boolean
  message: string | null
  setAppUpdateInProgress: (inProgress: boolean, message?: string) => void
}

const AppUpdateContext = createContext<AppUpdateContextType | undefined>(undefined)

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [inProgress, setInProgress] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const setAppUpdateInProgress = useCallback((value: boolean, msg?: string) => {
    setInProgress(value)
    setMessage(value ? msg ?? "Updating..." : null)
  }, [])

  return (
    <AppUpdateContext.Provider value={{ inProgress, message, setAppUpdateInProgress }}>
      {children}
      {inProgress && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm"
          aria-modal="true"
          aria-label="Update in progress"
          role="alertdialog"
        >
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <div className="flex flex-col items-center gap-2 text-center px-4">
            <h2 className="text-xl font-semibold">Update in progress</h2>
            {message && (
              <p className="text-muted-foreground max-w-md">{message}</p>
            )}
            <p className="text-sm text-muted-foreground">Do not close this window.</p>
          </div>
        </div>
      )}
    </AppUpdateContext.Provider>
  )
}

export function useAppUpdate() {
  const context = useContext(AppUpdateContext)
  if (context === undefined) {
    throw new Error("useAppUpdate must be used within an AppUpdateProvider")
  }
  return context
}
