import { useState, useEffect } from "react"
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
import { Copy, Check, ExternalLink, RefreshCw, ChevronDown, ChevronUp } from "lucide-react"

interface AuthModalProps {
  open: boolean
  onClose: () => void
  url: string
  code: string
}

function AuthModal({ open, onClose, url, code }: AuthModalProps) {
  const [copied, setCopied] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [status, setStatus] = useState<"checking" | "authenticated" | "failed">("checking")
  const [showOutput, setShowOutput] = useState(false)
  const [output, setOutput] = useState<{ stdout: string; stderr: string }>({ stdout: "", stderr: "" })

  // Auto-open URL when modal opens
  useEffect(() => {
    if (open && url) {
      window.open(url, "_blank")
    }
  }, [open, url])

  const copyUrl = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const copyCode = async () => {
    await navigator.clipboard.writeText(code)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const openUrl = () => {
    window.open(url, "_blank")
  }

  useEffect(() => {
    if (!open) return

    const intervalId = setInterval(async () => {
      try {
        const statusData = await apiClient.getDownloaderAuthStatus()
        // Update output from status check
        if (statusData.stdout || statusData.stderr) {
          setOutput({
            stdout: statusData.stdout || "",
            stderr: statusData.stderr || ""
          })
        }
        
        if (statusData.authenticated) {
          setStatus("authenticated")
          clearInterval(intervalId)
          setTimeout(() => {
            onClose()
          }, 2000)
        }
      } catch (error) {
        console.error("Failed to check auth status:", error)
      }
    }, 2000)

    return () => clearInterval(intervalId)
  }, [open, onClose])

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-popover/95 backdrop-blur-xl border-border/50">
        <DialogHeader>
          <DialogTitle>Authenticate Hytale Downloader</DialogTitle>
          <DialogDescription>
            Complete the authentication to enable server downloads.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Authentication URL at top with auto-open */}
          <div className="rounded-lg bg-secondary/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Authentication URL</span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyUrl}
                  className="h-8 px-2"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={openUrl}
                  className="h-8 px-2"
                >
                  <ExternalLink className="h-4 w-4 mr-1" />
                  Open
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground break-all font-mono">
              {url}
            </div>
            <p className="text-xs text-muted-foreground mt-2 italic">
              (Opens automatically in a new tab)
            </p>
          </div>

          {/* Authorization Code */}
          <div className="rounded-lg bg-secondary/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Authorization Code</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyCode}
                className="h-8 px-2"
              >
                {copiedCode ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="text-2xl font-mono font-bold tracking-wider text-primary">
              {code}
            </div>
            <div className="text-xs text-muted-foreground">
              <p>Or use the verification URL directly:</p>
              <p className="font-mono break-all mt-1">https://oauth.accounts.hytale.com/oauth2/device/verify?user_code={code}</p>
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            <p>1. Log in with your Hytale account (page opens automatically)</p>
            <p>2. Enter the authorization code above: <strong className="text-primary">{code}</strong></p>
            <p>3. Wait for authentication to complete</p>
          </div>

          {status === "checking" && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Waiting for authentication...
            </div>
          )}

          {status === "authenticated" && (
            <div className="flex items-center justify-center gap-2 text-sm text-green-500">
              <Check className="h-4 w-4" />
              Authentication successful!
            </div>
          )}

          {/* Terminal Output */}
          {(output.stdout || output.stderr) && (
            <div className="rounded-lg bg-secondary/50 border border-border/50">
              <button
                onClick={() => setShowOutput(!showOutput)}
                className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-secondary/70 transition-colors"
              >
                <span>Terminal Output</span>
                {showOutput ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              {showOutput && (
                <div className="p-3 pt-0 space-y-3">
                  {output.stdout && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">STDOUT:</div>
                      <pre className="text-xs font-mono bg-background/50 p-2 rounded border border-border/30 overflow-auto max-h-48 whitespace-pre-wrap break-words">
                        {output.stdout}
                      </pre>
                    </div>
                  )}
                  {output.stderr && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">STDERR:</div>
                      <pre className="text-xs font-mono bg-background/50 p-2 rounded border border-border/30 overflow-auto max-h-48 whitespace-pre-wrap break-words text-red-400">
                        {output.stderr}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" onClick={openUrl}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Authentication Page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { AuthModal }
