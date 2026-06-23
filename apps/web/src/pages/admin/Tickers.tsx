import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Plus, Trash2 } from 'lucide-react'

interface Ticker {
  id: string
  message: string
  sortOrder: number
  active: boolean
}

export function AdminTickers() {
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [loading, setLoading] = useState(true)
  const [newMessage, setNewMessage] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await apiClient<{ tickers: Ticker[] }>('/api/admin/tickers')
      setTickers(res.tickers)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function addTicker() {
    if (!newMessage.trim()) return
    setSaving(true)
    try {
      await apiClient('/api/admin/tickers', {
        method: 'POST',
        body: JSON.stringify({ message: newMessage.trim(), sortOrder: tickers.length }),
      })
      setNewMessage('')
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(id: string, active: boolean) {
    await apiClient(`/api/admin/tickers/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ active }),
    })
    await load()
  }

  async function remove(id: string) {
    await apiClient(`/api/admin/tickers/${id}`, { method: 'DELETE' })
    await load()
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Home Page Tickers</h1>
        <p className="text-muted-foreground text-sm">
          Scrolling announcements shown on the home page. Multiple active tickers flow together.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add ticker</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Input
            className="flex-1 min-w-[200px]"
            placeholder="e.g. New Elevate exercises available!"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
          />
          <Button onClick={addTicker} disabled={saving || !newMessage.trim()}>
            <Plus className="mr-2 h-4 w-4" /> Add
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {tickers.map((t) => (
          <Card key={t.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{t.message}</p>
                <p className="text-xs text-muted-foreground">Order: {t.sortOrder}</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={t.active}
                    onChange={(e) => toggleActive(t.id, e.target.checked)}
                  />
                  Active
                </label>
                <Button size="sm" variant="ghost" onClick={() => remove(t.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
