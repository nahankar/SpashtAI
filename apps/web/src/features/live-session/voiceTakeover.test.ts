import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { confirmVoiceTakeover, VOICE_TAKEOVER } from './voiceTakeover'

describe('voice takeover confirmation', () => {
  it('uses Cancel and an explicit takeover label', async () => {
    const confirm = vi.fn(async () => true)
    await expect(confirmVoiceTakeover(confirm, 'You already have a live session in this workspace.')).resolves.toBe(true)
    expect(confirm).toHaveBeenCalledWith({
      title: VOICE_TAKEOVER.title,
      description: 'You already have a live session in this workspace.',
      confirmLabel: 'Take over this session',
      cancelLabel: 'Cancel',
    })
    await expect(confirmVoiceTakeover(async () => false, 'stop')).resolves.toBe(false)
  })

  it('is wired through Elevate and Interviews, which already use ConfirmProvider', () => {
    const elevate = readFileSync(new URL('../../pages/Elevate.tsx', import.meta.url), 'utf8')
    const interviews = readFileSync(new URL('../../pages/Interviews.tsx', import.meta.url), 'utf8')
    expect(elevate).toContain('confirmVoiceTakeover(confirmDialog, message)')
    expect(interviews).toContain('confirmVoiceTakeover(confirmDialog,message)')
  })
})
