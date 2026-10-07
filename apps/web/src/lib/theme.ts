export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'spashtai_theme'
export const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

/** Light is the default so existing users keep the current look until they opt in. */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'light'
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

export function readStoredTheme(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'light'
  }
}

export function storeTheme(preference: ThemePreference, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Private browsing can reject storage; the theme still applies for this page.
  }
}

export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement) {
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}
