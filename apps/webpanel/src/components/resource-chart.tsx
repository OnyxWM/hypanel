import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface ResourceChartProps {
  title: string
  data: { time: string; value: number }[]
  color: string
  unit?: string
  maxValue?: number
}

export function ResourceChart({ title, data, color, unit = "%", maxValue }: ResourceChartProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickFormatter={(value) => value}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                domain={[0, maxValue || "auto"]}
                tickFormatter={(value) => `${value}${unit}`}
                width={40}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
                        <p className="text-sm font-medium text-foreground">
                          {payload[0].value}
                          {unit}
                        </p>
                        <p className="text-xs text-muted-foreground">{payload[0].payload.time}</p>
                      </div>
                    )
                  }
                  return null
                }}
              />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#gradient-${title})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
