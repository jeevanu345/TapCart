'use client'

import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'

import { cn } from '@/lib/utils'

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <progress
      data-slot="progress"
      className={cn('progress progress-primary w-full', className)}
      value={value || 0}
      max={100}
    />
  )
}

export { Progress }
