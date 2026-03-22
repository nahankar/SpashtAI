import { createContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { apiClient } from '@/lib/api-client'

export interface AuthUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  avatar: string | null
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN'
  emailVerified: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  register: (email: string, password: string, firstName?: string, lastName?: string) => Promise<AuthUser>
  logout: () => void
  isAdmin: boolean
  updateUser: (data: Partial<AuthUser>) => void
}

export const AuthContext = createContext<AuthContextType | null>(null)

const TOKEN_KEY = 'spashtai_token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchCurrentUser = useCallback(async () => {
    try {
      const data = await apiClient<{ user: AuthUser }>('/api/auth/me')
      setUser(data.user)
    } catch {
      localStorage.removeItem(TOKEN_KEY)
      setUser(null)
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

  const register = useCallback(async (
    email: string,
    password: string,
    firstName?: string,
    lastName?: string
  ): Promise<AuthUser> => {
    const data = await apiClient<{ token: string; user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, firstName, lastName }),
      skipAuth: true,
    })
    localStorage.setItem(TOKEN_KEY, data.token)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(() => {
    apiClient('/api/auth/logout', { method: 'POST' }).catch(() => {})
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
  }, [])

  const updateUser = useCallback((data: Partial<AuthUser>) => {
    setUser((prev) => (prev ? { ...prev, ...data } : null))
  }, [])

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, isAdmin, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}
