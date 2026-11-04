import { describe, expect, it, vi } from 'vitest'
import { bindVoiceTakeover, confirmVoiceTakeover, VOICE_TAKEOVER } from './voiceTakeover'

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

  it('binds the same dialog for Elevate and Interviews', async () => {
    const confirm = vi.fn(async () => true)
    const takeover = bindVoiceTakeover(confirm)
    await expect(takeover('You already have a live session in this workspace.')).resolves.toBe(true)
    expect(confirm).toHaveBeenCalledWith({
      title: VOICE_TAKEOVER.title,
      description: 'You already have a live session in this workspace.',
      confirmLabel: 'Take over this session',
      cancelLabel: 'Cancel',
    })
  })
})
