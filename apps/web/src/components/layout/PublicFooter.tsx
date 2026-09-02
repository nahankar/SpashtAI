import { Link } from 'react-router-dom'

export function PublicFooter() {
  return (
    <footer className="border-t bg-card/30 mt-auto">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">
        <div className="grid gap-8 sm:grid-cols-2 text-sm">
          <div className="space-y-2">
            <h3 className="font-medium text-foreground">About us</h3>
            <p className="text-muted-foreground leading-relaxed">
              VAAJAM builds technology products that enhance people &amp; enterprise experiences.
              SpashtAI is an AI-powered communication coach developed by VAAJAM.
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="font-medium text-foreground">Contact us</h3>
            <div className="text-muted-foreground leading-relaxed space-y-0.5">
              <p>VAAJAM / SpashtAI</p>
              <p>Hyderabad, Telangana, India</p>
              <p>
                Email:{' '}
                <a
                  href="mailto:info@spasht.ai"
                  className="hover:text-foreground transition-colors underline-offset-2 hover:underline"
                >
                  info@spasht.ai
                </a>
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t pt-6 text-center">
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
            SpashtAI is a product of VAAJAM. © 2026 VAAJAM / SpashtAI. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
