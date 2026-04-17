import { create } from 'zustand'

export interface User {
  id: string
  email: string
  display_name: string | null
  is_verified: boolean
  created_at: number
}

interface AuthState {
  user: User | null
  // Token is stored in HttpOnly cookie (not accessible from JS for XSS protection)
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null

  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName?: string) => Promise<void>
  logout: () => Promise<void>
  initialize: () => Promise<void>
  setUser: (user: User | null) => void
  clearError: () => void
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null })
    try {
      // credentials: 'include' sends/receives HttpOnly cookies
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'Login failed')
      }

      const { user } = await res.json()

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      set({ error: message, isLoading: false })
      throw err
    }
  },

  register: async (email: string, password: string, displayName?: string) => {
    set({ isLoading: true, error: null })
    try {
      // credentials: 'include' sends/receives HttpOnly cookies
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, display_name: displayName }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'Registration failed')
      }

      const { user } = await res.json()

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      set({ error: message, isLoading: false })
      throw err
    }
  },

  initialize: async () => {
    // Verify session by fetching current user
    // Browser automatically sends HttpOnly cookies
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'include',
      })

      if (res.ok) {
        const user = await res.json()
        set({ user, isAuthenticated: true, isLoading: false })
      } else {
        // Not authenticated, clear state
        set({ user: null, isAuthenticated: false, isLoading: false })
      }
    } catch {
      set({ isLoading: false })
    }
  },

  logout: async () => {
    // Call backend to clear cookies
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Ignore errors, clear local state anyway
    }
    set({
      user: null,
      isAuthenticated: false,
      error: null,
    })
  },

  setUser: (user: User | null) => {
    set({ user, isAuthenticated: !!user })
  },

  clearError: () => {
    set({ error: null })
  },
}))
