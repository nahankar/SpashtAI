import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { currentWorkspaceDownload } from '../client'
import { getActiveWorkspace } from '../activeWorkspace'
import { useWorkspaceShell } from '../shell/context'
import { ErrorAlert } from './parts'

export function ExportButton({ path, filename }: { path: string; filename: string }) {
  const { slug } = useWorkspaceShell()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function download() {
    setBusy(true); setError('')
    let url: string | undefined
    try {
      const active = getActiveWorkspace()
      if (!active) throw new Error('Open the workspace again to continue')
      const result = await currentWorkspaceDownload(active.token, path)
      url = URL.createObjectURL(result.blob)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = result.filename ?? `${slug}-${filename}`
      document.body.append(anchor); anchor.click(); anchor.remove()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to export') }
    finally { if (url) URL.revokeObjectURL(url); setBusy(false) }
  }
  return <div className="space-y-2">
    <Button variant="outline" disabled={busy} onClick={download}><Download className="mr-2 h-4 w-4" />{busy ? 'Exporting...' : 'Export to Excel'}</Button>
    <ErrorAlert error={error} />
  </div>
}
