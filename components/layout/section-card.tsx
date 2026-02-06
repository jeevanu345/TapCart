import type React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface SectionCardProps {
  title?: string
  description?: string
  actions?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function SectionCard({ title, description, actions, className, children }: SectionCardProps) {
  return (
    <Card className={cn("border-border/60 bg-surface", className)}>
      {(title || description || actions) && (
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {title ? <CardTitle className="text-lg font-semibold">{title}</CardTitle> : null}
            {description ? <CardDescription className="text-sm">{description}</CardDescription> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
    </Card>
  )
}
