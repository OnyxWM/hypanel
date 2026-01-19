import { createContext, useContext, useState, useCallback } from "react"
import type { ReactNode } from "react"

interface SidebarContextType {
  isOpen: boolean
  toggle: () => void
  close: () => void
  open: () => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])
  const close = useCallback(() => setIsOpen(false), [])
  const open = useCallback(() => setIsOpen(true), [])

  return (
    <SidebarContext.Provider value={{ isOpen, toggle, close, open }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (context === undefined) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}
