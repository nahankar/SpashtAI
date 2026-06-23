import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Plus, Trash2, Check } from 'lucide-react'

interface PlanFeature {
  id: string
  text: string
  sortOrder: number
}

interface Plan {
  id: string
  name: string
  priceMonthly: number
  description: string | null
  isPromoted: boolean
  sortOrder: number
  features: PlanFeature[]
}

interface Settings {
  enabled: boolean
  comingSoonText: string | null
}

export function AdminPricing() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({
    name: '',
    priceMonthly: '',
    description: '',
    features: '',
    isPromoted: false,
  })

  async function load() {
    setLoading(true)
    try {
      const res = await apiClient<{ settings: Settings; plans: Plan[] }>('/api/admin/pricing')
      setSettings(res.settings)
      setPlans(res.plans)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function saveSettings(patch: Partial<Settings>) {
    await apiClient('/api/admin/pricing/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    })
    await load()
  }

  async function addPlan() {
    if (!draft.name.trim()) return
    const features = draft.features
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    await apiClient('/api/admin/pricing/plans', {
      method: 'POST',
      body: JSON.stringify({
        name: draft.name.trim(),
        priceMonthly: Number(draft.priceMonthly) || 0,
        description: draft.description.trim() || null,
        isPromoted: draft.isPromoted,
        sortOrder: plans.length,
        features,
      }),
    })
    setDraft({ name: '', priceMonthly: '', description: '', features: '', isPromoted: false })
    await load()
  }

  async function promote(id: string) {
    await apiClient(`/api/admin/pricing/plans/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ isPromoted: true }),
    })
    await load()
  }

  async function removePlan(id: string) {
    await apiClient(`/api/admin/pricing/plans/${id}`, { method: 'DELETE' })
    await load()
  }

  if (loading || !settings) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pricing</h1>
        <p className="text-muted-foreground text-sm">Configure pricing columns and enable the public pricing page.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Page settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => saveSettings({ enabled: e.target.checked })}
            />
            Enable pricing page in navigation
          </label>
          <div className="space-y-1">
            <Label>Coming soon text (shown when no plans or page disabled)</Label>
            <Textarea
              rows={2}
              value={settings.comingSoonText ?? ''}
              onChange={(e) => setSettings({ ...settings, comingSoonText: e.target.value })}
              onBlur={() => saveSettings({ comingSoonText: settings.comingSoonText })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add plan column</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Plan name</Label>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Price / month ($)</Label>
            <Input
              type="number"
              value={draft.priceMonthly}
              onChange={(e) => setDraft({ ...draft, priceMonthly: e.target.value })}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Description</Label>
            <Input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Features (one per line)</Label>
            <Textarea
              rows={4}
              value={draft.features}
              onChange={(e) => setDraft({ ...draft, features: e.target.value })}
              placeholder="All limited links&#10;Own analytics platform"
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={draft.isPromoted}
              onChange={(e) => setDraft({ ...draft, isPromoted: e.target.checked })}
            />
            Promoted (highlighted column)
          </label>
          <Button onClick={addPlan} disabled={!draft.name.trim()}>
            <Plus className="mr-2 h-4 w-4" /> Add plan
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <Card
            key={plan.id}
            className={plan.isPromoted ? 'border-primary ring-2 ring-primary/30 bg-primary text-primary-foreground' : ''}
          >
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-lg">
                {plan.name}
                {plan.isPromoted && <Check className="h-4 w-4" />}
              </CardTitle>
              <p className="text-2xl font-bold">${plan.priceMonthly}/mo</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {plan.description && <p className="text-sm opacity-90">{plan.description}</p>}
              <ul className="space-y-1 text-sm">
                {plan.features.map((f) => (
                  <li key={f.id} className="flex items-start gap-2">
                    <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {f.text}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 pt-2">
                {!plan.isPromoted && (
                  <Button size="sm" variant="secondary" onClick={() => promote(plan.id)}>
                    Set promoted
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => removePlan(plan.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
