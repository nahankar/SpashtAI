import { cn } from '@/lib/utils'

type BrandNameProps = {
  className?: string
  size?: 'sm' | 'md' | 'lg'
  showBeta?: boolean
}

const sizeClass = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-2xl',
} as const

export function BrandName({ className, size = 'md', showBeta = true }: BrandNameProps) {
  return (
    <span className={cn('font-semibold tracking-tight', sizeClass[size], className)}>
      SpashtAI
      {showBeta && (
        <sup className="ml-0.5 text-[0.5em] font-medium text-muted-foreground align-super leading-none">
          beta
        </sup>
      )}
    </span>
  )
}

export const BRAND_ALT = 'SpashtAI beta'
