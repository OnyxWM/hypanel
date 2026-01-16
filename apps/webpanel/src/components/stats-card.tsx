import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface StatsCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: LucideIcon
  trend?: {
    value: number
    isPositive: boolean
  }
  className?: string
}

export function StatsCard({ title, value, subtitle, icon: Icon, trend, className }: StatsCardProps) {
  return (
    <Card
      className={cn(
        "bg-card backdrop-blur-xl border-border/50 hover:shadow-lg hover:shadow-primary/5 transition-all",
        className,
      )}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            {trend && (
              <p className={cn("text-xs font-medium", trend.isPositive ? "text-success" : "text-destructive")}>
                {trend.isPositive ? "↑" : "↓"} {Math.abs(trend.value)}%
              </p>
            )}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 backdrop-blur-sm border border-primary/20">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
