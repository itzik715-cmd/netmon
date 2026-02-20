import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthUser {
  id: number
  username: string
  role: string
  must_change_password: boolean
}

interface AuthState {
  token: string | null
  refreshToken: string | null
  user: AuthUser | null
  setAuth: (token: string, refreshToken: string, user: AuthUser) => void
  updateUser: (updates: Partial<AuthUser>) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      setAuth: (token, refreshToken, user) => set({ token, refreshToken, user }),
      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),
      logout: () => set({ token: null, refreshToken: null, user: null }),
    }),
    {
      name: 'netmon-auth',
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
    }
  )
)
