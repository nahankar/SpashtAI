import { Toaster } from 'sonner'
import { useTheme } from '@/contexts/ThemeContext'

export function ThemedToaster() {
  const { theme } = useTheme()
  return <Toaster richColors closeButton theme={theme} />
}
