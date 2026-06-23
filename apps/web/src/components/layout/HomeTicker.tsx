import { useEffect, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export function HomeTicker() {
  const [messages, setMessages] = useState<string[]>([])

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/tickers`)
      .then((r) => r.json())
      .then((d) => setMessages((d.tickers ?? []).map((t: { message: string }) => t.message)))
      .catch(() => setMessages([]))
  }, [])

  if (messages.length === 0) return null

  const text = messages.join('   •   ')

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/40 py-2">
      <div className="animate-ticker whitespace-nowrap text-sm text-muted-foreground">
        <span className="inline-block px-4">{text}</span>
        <span className="inline-block px-4" aria-hidden>
          {text}
        </span>
      </div>
    </div>
  )
}
