import type React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface StatCardProps {
  title: string
  value: React.ReactNode
  helper?: string
  icon?: React.ReactNode
  accent?: "primary" | "success" | "warning" | "danger" | "neutral"
  className?: string
}

const accentStyles: Record<NonNullable<StatCardProps["accent"]>, string> = {
  primary: "text-primary bg-primary/10",
  success: "text-success bg-success/10",
  warning: "text-warning bg-warning/10",
  danger: "text-danger bg-danger/10",
  neutral: "text-muted-foreground bg-surface-muted",
}

export function StatCard({ title, value, helper, icon, accent = "neutral", className }: StatCardProps) {
  return (
    <Card className={cn("border-border/60 bg-surface", className)}>
      <CardContent className="px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
            <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
            {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
          </div>
          {icon ? (
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-full", accentStyles[accent])}>
              {icon}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
