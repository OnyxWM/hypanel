import { AlertCircle, Key, ExternalLink } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

interface AuthGuidanceProps {
  serverId: string
  className?: string
}

export function AuthGuidance({ serverId, className }: AuthGuidanceProps) {
  return (
    <Alert className={`bg-destructive/10 border-destructive/30 backdrop-blur-sm ${className}`}>
      <AlertCircle className="h-4 w-4 text-destructive" />
      <AlertDescription className="space-y-3">
        <div>
          <strong>Authentication Required</strong>
          <p className="text-sm mt-1">
            This server requires authentication to continue. Please follow these steps:
          </p>
        </div>
        
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Key className="h-3 w-3 text-destructive" />
            <span>Go to the server console and run:</span>
          </div>
          <div className="bg-muted/50 p-2 rounded font-mono text-xs ml-5">
            /auth login device
          </div>
          <div className="ml-5">
            Follow the URL and enter the code provided in the console to authenticate.
          </div>
        </div>

        <div className="pt-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => window.open(`/servers/${serverId}/console`, '_blank')}
          >
            <ExternalLink className="mr-2 h-3 w-3" />
            Open Console
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}