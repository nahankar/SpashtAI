import { useState } from 'react'
import { Paperclip, Loader2 } from 'lucide-react'
import { getAuthHeaders } from '@/lib/api-client'

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export function FeedbackAttachmentLink({
  href,
  fileName,
}: {
  href: string
  fileName: string
}) {
  const [loading, setLoading] = useState(false)

  const open = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}${href}`, { headers: getAuthHeaders() })
      if (!res.ok) throw new Error('Failed to load attachment')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      window.alert('Could not open attachment. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted/50 disabled:opacity-50"
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
      {fileName}
    </button>
  )
}
