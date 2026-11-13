import { createContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { clearPendingGoogleSignup, withGoogleSignupContinuation } from '@/lib/pending-google-signup'
import { ApiError, apiClient } from '@/lib/api-client'
import { isWorkspaceFailure, WorkspaceContextError } from '@/workspaces/activeWorkspace'

export interface AuthUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  avatar: string | null
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN'
  emailVerified: boolean
  tenantOnly?: boolean
  lastLoginAt: string | null
  createdAt: string
  rewardPoints?: number
  profileComplete?: boolean
  needsProfileCompletion?: boolean
  hideTranscriptText?: boolean
  hideTranscriptJsonExport?: boolean
  hideAudioDownload?: boolean
  enableTxtExport?: boolean
  enableJsonExport?: boolean
  enableAudioExport?: boolean
  enableReplayAudioUpload?: boolean
  enableReprocess?: boolean
  enablePro?: boolean
  enableUltra?: boolean
  speakerAliases?: string[]
}

export interface RegisterData {
  email: string
  password: string
  firstName?: string
  lastName?: string
  phone: string
  dateOfBirth: string
  gender: string
  pincode: string
  acceptedTerms: boolean
}

export interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  loginForDevelopment: (email: string, password: string) => Promise<AuthUser>
  loginWithGoogle: (credential: string, profile?: { phone: string; dateOfBirth: string; gender: string; pincode: string }, workspaceSlug?: string) => Promise<AuthUser>
  loginWithEmailCode: (challengeId: string, code: string, profile?: { phone: string; dateOfBirth: string; gender: string; pincode: string }, workspaceSlug?: string) => Promise<AuthUser>
  register: (data: RegisterData) => Promise<AuthUser>
  logout: () => void
  isAdmin: boolean
  updateUser: (data: Partial<AuthUser>) => void
  fetchCurrentUser: () => Promise<void>
}

// Provider and context are colocated so their public contract cannot drift.
// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextType | null>(null)

const TOKEN_KEY = 'spashtai_token'

/** Sign out only when the identity itself was rejected — not missing workspace context or a dropped connection. */
export function isGenuineIdentityRejection(error: unknown): boolean {
  if (error instanceof WorkspaceContextError) return false
  if (error instanceof TypeError) return false
  if (error instanceof ApiError) {
    if (isWorkspaceFailure(error.code)) return false
    return error.status === 401
  }
  return error instanceof Error && error.message === 'Authentication required'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchCurrentUser = useCallback(async () => {
    try {
      const data = await apiClient<{ user: AuthUser }>('/api/auth/me', { identityOnly: true })
      setUser(data.user)
    } catch (error) {
      if (isGenuineIdentityRejection(error)) {
        localStorage.removeItem(TOKEN_KEY)
        setUser(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) {
      fetchCurrentUser()
    } else {
      setLoading(false)
    }
  }, [fetchCurrentUser])

  // An invitation accepted in another tab must update navigation when this tab returns.
  useEffect(() => {
    const refresh = () => { if (localStorage.getItem(TOKEN_KEY)) void fetchCurrentUser() }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [fetchCurrentUser])

  const login = useCallback(async (email: string, password: string): Promise<AuthUser> => {
    const data = await apiClient<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    })
    localStorage.setItem(TOKEN_KEY, data.token)
    setUser(data.user)
    return data.user
  }, [])

  const loginForDevelopment = useCallback(async (email: string, password: string): Promise<AuthUser> => {
    const data = await apiClient<{ token: string; user: AuthUser }>('/api/auth/dev-login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    })
    localStorage.setItem(TOKEN_KEY, data.token)
    setUser(data.user)
    return data.user
  }, [])

  const loginWithGoogle = useCallback(async (
    credential: string,
    profile?: { phone: string; dateOfBirth: string; gender: string; pincode: string }, workspaceSlug?: string,
  ): Promise<AuthUser> => {
    const data = await withGoogleSignupContinuation(credential, workspaceSlug, () =>
      apiClient<{ token: string; user: AuthUser }>('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential, ...profile, workspaceSlug }),
        skipAuth: true,
      }))
    localStorage.setItem(TOKEN_KEY, data.token)
    setUser(data.user)
    return data.user
  }, [])

  const loginWithEmailCode = useCallback(async (
    challengeId: string, code: string,
    profile?: { phone: string; dateOfBirth: string; gender: string; pincode: string }, workspaceSlug?: string,
  ): Promise<AuthUser> => {
    const data = await apiClient<{ token: string; user: AuthUser }>('/api/auth/email-code/verify', {
      method: 'POST', body: JSON.stringify({ challengeId, code, ...profile, workspaceSlug }), skipAuth: true,
    })
    localStorage.setItem(TOKEN_KEY, data.token)
    setUser(data.user)
    return data.user
  }, [])

  const register = useCallback(async (data: RegisterData): Promise<AuthUser> => {
    const res = await apiClient<{ token: string; user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
      skipAuth: true,
    })
    localStorage.setItem(TOKEN_KEY, res.token)
    setUser(res.user)
    return res.user
  }, [])

  const logout = useCallback(() => {
    clearPendingGoogleSignup()
    apiClient('/api/auth/logout', { method: 'POST', identityOnly: true }).catch(() => {})
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
  }, [])

  const updateUser = useCallback((data: Partial<AuthUser>) => {
    setUser((prev) => (prev ? { ...prev, ...data } : null))
  }, [])

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        loginForDevelopment,
        loginWithGoogle,
        loginWithEmailCode,
        register,
        logout,
        isAdmin,
        updateUser,
        fetchCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
