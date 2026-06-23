import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { FeatureFlagState } from '@/contexts/FeatureFlagsContext'

export function FeatureModuleCard({
  title,
  description,
  icon,
  flag,
  accessible,
  children,
  footer,
}: {
  title: string
  description: string
  icon: ReactNode
  flag: FeatureFlagState
  accessible: boolean
  children: ReactNode
  footer?: ReactNode
}) {
  const overlay =
    flag.overlayComment?.trim() ||
    (flag.disabled ? 'This feature is temporarily unavailable.' : null)

  return (
    <Card
      className={`relative overflow-hidden transition-shadow ${
        accessible ? 'hover:shadow-lg' : ''
      }`}
    >
      <CardHeader>
        <div className="flex items-center gap-3">
          {icon}
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="relative">
        {accessible ? (
          children
        ) : (
          <div className="space-y-3">
            {overlay && (
              <div
                className={`rounded-md border border-primary/25 bg-primary/5 px-3 py-2.5 text-center ${
                  flag.overlayPosition === 'top' ? '' : ''
                }`}
              >
                <p className="text-sm font-medium text-foreground">{overlay}</p>
              </div>
            )}
            <Button className="w-full" size="lg" variant="outline" disabled>
              Unavailable
            </Button>
          </div>
        )}
        {footer}
      </CardContent>
    </Card>
  )
}

export function DisabledNavLink({
  label,
  comment,
}: {
  label: string
  comment?: string | null
}) {
  return (
    <span
      className="cursor-not-allowed text-muted-foreground/50"
      title={comment || `${label} is unavailable`}
    >
      {label}
    </span>
  )
}

export function AccessibleNavLink({
  to,
  label,
}: {
  to: string
  label: string
}) {
  return (
    <Link to={to} className="hover:text-foreground transition-colors">
      {label}
    </Link>
  )
}
