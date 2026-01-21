import { RefreshCw, Download, HardDrive, CheckCircle, XCircle, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type UpdateProgressState = "checking" | "backing_up" | "downloading" | "installing" | "success" | "error"

interface UpdateProgressModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: UpdateProgressState
  error?: string
  currentVersion?: string
  latestVersion?: string
}

const stateConfig = {
  checking: {
    label: "Checking for updates...",
    icon: RefreshCw,
    color: "text-blue-500",
    description: "Checking if a new version is available",
  },
  backing_up: {
    label: "Creating backup...",
    icon: HardDrive,
    color: "text-blue-500",
    description: "Backing up server data before update",
  },
  downloading: {
    label: "Downloading update...",
    icon: Download,
    color: "text-blue-500",
    description: "Downloading the latest server version",
  },
  installing: {
    label: "Installing update...",
    icon: Loader2,
    color: "text-blue-500",
    description: "Installing the update",
  },
  success: {
    label: "Update completed successfully!",
    icon: CheckCircle,
    color: "text-green-500",
    description: "The server has been updated to the latest version",
  },
  error: {
    label: "Update failed",
    icon: XCircle,
    color: "text-destructive",
    description: "An error occurred during the update",
  },
}

export function UpdateProgressModal({
  open,
  onOpenChange,
  state,
  error,
  currentVersion,
  latestVersion,
}: UpdateProgressModalProps) {
  const config = stateConfig[state]
  const Icon = config.icon
  const isProcessing = state === "checking" || state === "backing_up" || state === "downloading" || state === "installing"
  const canClose = state === "success" || state === "error"

  return (
    <Dialog open={open} onOpenChange={canClose ? onOpenChange : undefined}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Server Update</DialogTitle>
          <DialogDescription>
            {state === "checking" && currentVersion && latestVersion
              ? `Current version: ${currentVersion} → Latest version: ${latestVersion}`
              : config.description}
          </DialogDescription>
        </DialogHeader>

        <div className="py-6">
          <div className="flex flex-col items-center justify-center space-y-4">
            {/* Icon with animation */}
            <div className="relative">
              <Icon
                className={cn(
                  "h-16 w-16",
                  config.color,
                  isProcessing && "animate-spin"
                )}
              />
            </div>

            {/* Status text */}
            <div className="text-center space-y-2">
              <p className="text-lg font-medium">{config.label}</p>
              {state === "success" && currentVersion && latestVersion && (
                <p className="text-sm text-muted-foreground">
                  {currentVersion === latestVersion 
                    ? `Server on latest version (${currentVersion})`
                    : `Updated from ${currentVersion} to ${latestVersion}`}
                </p>
              )}
              {state === "error" && error && (
                <div className="mt-4 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-left">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}
            </div>

            {/* Progress indicator for processing states */}
            {isProcessing && (
              <div className="w-full space-y-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/30">
                  <div
                    className={cn(
                      "h-full bg-primary transition-all",
                      state === "checking" && "w-1/4",
                      state === "backing_up" && "w-2/4",
                      state === "downloading" && "w-3/4",
                      state === "installing" && "w-full"
                    )}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            disabled={!canClose}
            variant={state === "success" ? "default" : "outline"}
          >
            {state === "success" ? "Done" : state === "error" ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
