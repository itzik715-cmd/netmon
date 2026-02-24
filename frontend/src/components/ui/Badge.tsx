import { ReactNode } from 'react'

type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral'

interface BadgeProps {
  variant: BadgeVariant
  children: ReactNode
  dot?: boolean
  pulse?: boolean
  className?: string
}

export default function Badge({ variant, children, dot, pulse, className = '' }: BadgeProps) {
  return (
    <span className={`badge badge--${variant} ${className}`}>
      {dot && <span className={`badge__dot ${pulse ? 'badge__dot--pulse' : ''}`} />}
      {children}
    </span>
  )
}
