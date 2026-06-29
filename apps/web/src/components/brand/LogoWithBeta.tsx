import { cn } from '@/lib/utils'

type LogoWithBetaProps = {
  className?: string
  imgClassName?: string
}

/** Logo image with beta superscript — no duplicate SpashtAI text (wordmark is in the SVG). */
export function LogoWithBeta({ className, imgClassName }: LogoWithBetaProps) {
  return (
    <span className={cn('relative inline-flex items-start shrink-0', className)}>
      <img
        src="/spashtai_logo.svg"
        alt="SpashtAI beta"
        className={cn('h-6 sm:h-7 w-auto', imgClassName)}
      />
      <sup className="ml-0.5 text-[0.55rem] sm:text-[0.6rem] font-medium text-muted-foreground leading-none align-super -mt-0.5">
        beta
      </sup>
    </span>
  )
}
