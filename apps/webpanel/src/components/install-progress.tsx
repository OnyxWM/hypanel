import { Download, CheckCircle, XCircle, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { InstallProgress, InstallState } from "@/lib/api"

interface InstallProgressProps {
  installState?: InstallState
  lastError?: string
  progress?: InstallProgress
  className?: string
}

const stageConfig = {
  queued: { label: "Queued", icon: Loader2, color: "text-warning" },
  downloading: { label: "Downloading", icon: Download, color: "text-blue-500" },
  extracting: { label: "Extracting", icon: Loader2, color: "text-blue-500" },
  verifying: { label: "Verifying", icon: Loader2, color: "text-blue-500" },
  ready: { label: "Ready", icon: CheckCircle, color: "text-green-500" },
  failed: { label: "Failed", icon: XCircle, color: "text-destructive" },
}

const installStateConfig = {
  NOT_INSTALLED: { label: "Not Installed", className: "bg-muted/50 text-muted-foreground border-border/30" },
  INSTALLING: { label: "Installing", className: "bg-blue-500/20 text-blue-500 border-blue-500/30 animate-pulse" },
  INSTALLED: { label: "Installed", className: "bg-green-500/20 text-green-500 border-green-500/30" },
  FAILED: { label: "Failed", className: "bg-destructive/20 text-destructive border-destructive/30" },
}

export function InstallProgressDisplay({ installState, lastError, progress, className }: InstallProgressProps) {
  if (!installState || installState === "NOT_INSTALLED") {
    return null
  }

  const stateConfig = installStateConfig[installState]
  
  return (
    <div className={cn("space-y-3", className)}>
      {/* Status Badge */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={cn("text-xs", stateConfig.className)}>
          {stateConfig.label}
        </Badge>
        {progress && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <span className={cn("h-2 w-2 rounded-full", 
              progress.stage === "ready" ? "bg-green-500" :
              progress.stage === "failed" ? "bg-destructive" : "bg-blue-500 animate-pulse"
            )} />
            {stageConfig[progress.stage]?.label || progress.stage}
          </span>
        )}
      </div>

      {/* Progress Bar and Message */}
      {progress && progress.stage !== "queued" && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Progress</span>
            <span className="text-foreground">{progress.progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/30">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.progress}%` }}
            />
          </div>
          {progress.message && (
            <p className="text-xs text-muted-foreground">{progress.message}</p>
          )}
        </div>
      )}

      {/* Error Display */}
      {lastError && installState === "FAILED" && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
          <div className="flex items-start gap-2">
            <XCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Installation Failed</p>
              <p className="text-xs text-muted-foreground">{lastError}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}