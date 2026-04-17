import { useCallback, useEffect } from 'react'
import { useAuthStore, type User } from '../stores/authStore'

/**
 * Hook for accessing authentication state and actions.
 * Wraps the Zustand auth store for convenient component usage.
 *
 * Authentication is now cookie-based (HttpOnly cookies) for XSS protection.
 * The browser automatically sends cookies with credentials: 'include'.
 */
export function useAuth() {
  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    login,
    register,
    logout,
    initialize,
    setUser,
    clearError,
  } = useAuthStore()

  // Initialize auth state on mount - verify session via cookie
  useEffect(() => {
    initialize()
  }, [])

  /**
   * Check if user has a specific role (for future team features)
   */
  const hasRole = useCallback((role: string): boolean => {
    // Placeholder for team/role-based access control
    return isAuthenticated
  }, [isAuthenticated])

  /**
   * Clear any stored error state
   */
  const resetError = useCallback(() => {
    clearError()
  }, [clearError])

  return {
    // State
    user,
    isAuthenticated,
    isLoading,
    error,

    // Actions
    login,
    register,
    logout,
    setUser,

    // Utilities
    hasRole,
    resetError,
  }
}

export type { User }
