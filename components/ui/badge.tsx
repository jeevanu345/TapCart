import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'border-primary/20 bg-primary/10 text-primary',
      secondary: 'border-border bg-surface-muted text-foreground',
      destructive: 'border-danger/20 bg-danger/10 text-danger',
      outline: 'border-border bg-transparent text-foreground',
      success: 'border-success/20 bg-success/10 text-success',
      warning: 'border-warning/30 bg-warning/15 text-warning',
      info: 'border-primary/20 bg-primary/10 text-primary',
      ghost: 'border-transparent bg-transparent text-muted-foreground',
    },
    size: {
      default: 'text-xs',
      sm: 'text-[11px] px-2 py-0.5',
      lg: 'text-sm px-3 py-1',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
})

function Badge({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
