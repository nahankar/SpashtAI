import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Check, Loader2 } from 'lucide-react'
import { Navigate } from 'react-router-dom'

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface PlanFeature {
  id: string
  text: string
}

interface Plan {
  id: string
  name: string
  priceMonthly: number
  description: string | null
  isPromoted: boolean
  features: PlanFeature[]
}

export function Pricing() {
  const [enabled, setEnabled] = useState(false)
  const [comingSoonText, setComingSoonText] = useState<string | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/pricing`)
      .then((r) => r.json())
      .then((d) => {
        setEnabled(Boolean(d.enabled))
        setComingSoonText(d.comingSoonText ?? null)
        setPlans(d.plans ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading pricing…
      </div>
    )
  }

  if (!enabled) {
    return <Navigate to="/" replace />
  }

  if (plans.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <p className="text-lg text-muted-foreground">
            {comingSoonText || 'Pricing plans coming soon — stay tuned!'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Choose your plan</h1>
        <p className="text-muted-foreground mt-2">Flexible plans for every stage of your communication journey.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 items-end">
        {plans.map((plan) => (
          <Card
            key={plan.id}
            className={`relative flex flex-col ${
              plan.isPromoted
                ? 'lg:scale-105 z-10 border-0 bg-gradient-to-br from-indigo-900 to-violet-900 text-white shadow-xl'
                : 'bg-card'
            }`}
          >
            <CardHeader className="pb-2">
              <p className={`text-3xl font-bold ${plan.isPromoted ? '' : 'text-foreground'}`}>
                ${plan.priceMonthly}
                <span className="text-base font-normal opacity-80">/month</span>
              </p>
              <CardTitle className="text-xl">{plan.name}</CardTitle>
              {plan.description && (
                <p className={`text-sm ${plan.isPromoted ? 'text-white/80' : 'text-muted-foreground'}`}>
                  {plan.description}
                </p>
              )}
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <ul className="space-y-2 flex-1 text-sm">
                {plan.features.map((f) => (
                  <li key={f.id} className="flex items-start gap-2">
                    <Check className={`h-4 w-4 mt-0.5 shrink-0 ${plan.isPromoted ? 'text-pink-300' : 'text-primary'}`} />
                    {f.text}
                  </li>
                ))}
              </ul>
              <Button
                className={`mt-6 w-full ${plan.isPromoted ? 'bg-pink-500 hover:bg-pink-600 text-white' : ''}`}
                variant={plan.isPromoted ? 'default' : 'outline'}
              >
                Choose Plan
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
