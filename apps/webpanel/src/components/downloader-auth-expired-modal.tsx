import { useEffect, useState } from "react"

import { AuthModal } from "@/components/auth-modal"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { apiClient } from "@/lib/api-client"
import { onDownloaderAuthExpired } from "@/lib/downloader-auth-expired-events"

export function DownloaderAuthExpiredModal() {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authData, setAuthData] = useState<{ url: string; code: string } | null>(null)

  useEffect(() => {
    return onDownloaderAuthExpired(() => {
      setError(null)
      setOpen(true)
    })
  }, [])

  const handleAuthenticate = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const data = await apiClient.startDownloaderAuth()
      setAuthData(data)
      setAuthModalOpen(true)
      setOpen(false)
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Failed to start downloader authentication")
    } finally {
      setIsLoading(false)
    }
  }

  const handleAuthModalClose = () => {
    setAuthModalOpen(false)
    setAuthData(null)
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (isLoading) return
          setOpen(nextOpen)
          if (!nextOpen) {
            setError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Downloader credentials expired</DialogTitle>
            <DialogDescription>
              The saved Hytale downloader credentials expired and were cleared automatically. Please authenticate the downloader again before installing or updating servers.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Authentication failed to start</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isLoading}>
              Dismiss
            </Button>
            <Button onClick={handleAuthenticate} disabled={isLoading}>
              {isLoading ? "Starting..." : "Auth Downloader"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {authData && (
        <AuthModal
          open={authModalOpen}
          onClose={handleAuthModalClose}
          url={authData.url}
          code={authData.code}
        />
      )}
    </>
  )
}
