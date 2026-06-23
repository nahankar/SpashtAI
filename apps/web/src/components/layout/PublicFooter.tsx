import { Link } from 'react-router-dom'
import { BrandName } from '@/components/brand/BrandName'

export function PublicFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t bg-card/30 mt-auto">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 text-center space-y-2">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
          <Link
            to="/terms?from=login"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Terms and Conditions
          </Link>
          <span className="text-muted-foreground/40 hidden sm:inline">|</span>
          <Link
            to="/privacy?from=login"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Privacy Policy
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          © {year} <BrandName size="sm" className="inline text-xs" />. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
