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
  sessionStart: string | null
  sessionMaxSeconds: number | null
  setAuth: (token: string, refreshToken: string, user: AuthUser, sessionStart?: string | null, sessionMaxSeconds?: number | null) => void
  updateUser: (updates: Partial<AuthUser>) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      sessionStart: null,
      sessionMaxSeconds: null,
      setAuth: (token, refreshToken, user, sessionStart, sessionMaxSeconds) =>
        set({
          token, refreshToken, user,
          ...(sessionStart !== undefined ? { sessionStart } : {}),
          ...(sessionMaxSeconds !== undefined ? { sessionMaxSeconds } : {}),
        }),
      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),
      logout: () => set({ token: null, refreshToken: null, user: null, sessionStart: null, sessionMaxSeconds: null }),
    }),
    {
      name: 'netmon-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        sessionStart: state.sessionStart,
        sessionMaxSeconds: state.sessionMaxSeconds,
      }),
    }
  )
)
