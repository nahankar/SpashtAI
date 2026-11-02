import { describe, expect, it } from 'vitest'
import { recordingByteRange, workspaceRecordingKey } from '../src/workspaces/sessionMedia'

describe('workspace recording references and byte ranges', () => {
  it('namespaces every object by workspace, session and recording', () => {
    expect(workspaceRecordingKey('one', 'session-one', 'audio-one', 'webm')).toBe('workspaces/one/sessions/session-one/audio-one.webm')
    expect(workspaceRecordingKey('two', 'session-one', 'audio-one', 'webm')).not.toBe(workspaceRecordingKey('one', 'session-one', 'audio-one', 'webm'))
  })
  it.each(['../other', '/etc/passwd', 'one/two', 'one\\two', '', '%2e%2e'])('rejects unsafe namespace %s', value => {
    expect(() => workspaceRecordingKey(value, 'session', 'recording', 'webm')).toThrow()
  })
  it.each(['svg', 'html', '../wav', '__proto__', 'constructor'])('rejects unsupported extension %s', extension => {
    expect(() => workspaceRecordingKey('one', 'session', 'recording', extension)).toThrow()
  })
  it('supports full, bounded, open-ended and suffix requests', () => {
    expect(recordingByteRange(undefined, 10)).toEqual({ start: 0, end: 9, partial: false })
    expect(recordingByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5, partial: true })
    expect(recordingByteRange('bytes=7-', 10)).toEqual({ start: 7, end: 9, partial: true })
    expect(recordingByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9, partial: true })
    expect(recordingByteRange('bytes=7-999', 10)).toEqual({ start: 7, end: 9, partial: true })
  })
  it.each(['bytes=-0', 'bytes=-', 'bytes=9-3', 'bytes=10-', 'bytes=0-1,5-6', 'bytes=9999999999999999999-', 'wrong=0-4'])('rejects invalid or unsupported range %s', range => {
    expect(recordingByteRange(range, 10)).toBeNull()
  })
})
