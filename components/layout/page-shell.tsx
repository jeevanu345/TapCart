import type React from "react"
import { cn } from "@/lib/utils"

export function PageShell({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-screen bg-background text-foreground", className)}
      {...props}
    >
      <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
        {children}
      </div>
    </div>
  )
}
