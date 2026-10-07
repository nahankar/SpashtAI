import { describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY, applyTheme, parseThemePreference, readStoredTheme, resolveTheme, storeTheme } from './theme'

describe('theme preference', () => {
  it('defaults missing or unknown values to light', () => {
    expect(parseThemePreference('dark')).toBe('dark')
    expect(parseThemePreference('system')).toBe('system')
    expect(parseThemePreference('neon')).toBe('light')
    expect(parseThemePreference(null)).toBe('light')
  })

  it('follows the OS only for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('persists per browser and tolerates unavailable storage', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
    storeTheme('dark', storage)
    expect(data.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(readStoredTheme(storage)).toBe('dark')
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(readStoredTheme(broken)).toBe('light')
    expect(() => storeTheme('light', broken)).not.toThrow()
  })

  it('toggles the dark class and colour scheme on the root element', () => {
    const classes = new Set<string>()
    const root = { classList: { toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c) } }, style: { colorScheme: '' } }
    applyTheme('dark', root as unknown as HTMLElement)
    expect(classes.has('dark')).toBe(true); expect(root.style.colorScheme).toBe('dark')
    applyTheme('light', root as unknown as HTMLElement)
    expect(classes.has('dark')).toBe(false); expect(root.style.colorScheme).toBe('light')
  })
})
