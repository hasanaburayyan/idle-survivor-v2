import { create } from 'zustand';

export type AuthMode = 'signin' | 'signup';

interface AuthUiState {
  mode: AuthMode;
  lastAuthError: string | null;
  setMode: (mode: AuthMode) => void;
  setLastAuthError: (message: string) => void;
  clearAuthError: () => void;
}

export const useAuthUiStore = create<AuthUiState>(set => ({
  mode: 'signin',
  lastAuthError: null,
  setMode: mode => set({ mode, lastAuthError: null }),
  setLastAuthError: message => set({ lastAuthError: message }),
  clearAuthError: () => set({ lastAuthError: null }),
}));
