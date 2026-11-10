import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api, ApiError, type Me } from './api';
import { tokenStore } from './token-store';

interface AuthState {
  ready: boolean;
  token: string | null;
  me: Me | null;
  /** Saves a new session token and loads the account it belongs to. */
  adopt: (token: string) => Promise<Me>;
  refresh: () => Promise<Me | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  const load = useCallback(async (t: string | null): Promise<Me | null> => {
    if (!t) {
      setToken(null);
      setMe(null);
      return null;
    }
    try {
      const account = await api.me(t);
      setToken(t);
      setMe(account);
      return account;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await tokenStore.clear(); // expired or revoked session
        setToken(null);
        setMe(null);
        return null;
      }
      throw err;
    }
  }, []);

  useEffect(() => {
    tokenStore
      .get()
      .then(load)
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, [load]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      token,
      me,
      adopt: async (t) => {
        await tokenStore.set(t);
        const account = await load(t);
        if (!account) throw new ApiError(401, 'sign_in_required');
        return account;
      },
      refresh: () => load(token),
      signOut: async () => {
        if (token) await api.signOut(token).catch(() => undefined);
        await tokenStore.clear();
        setToken(null);
        setMe(null);
      },
    }),
    [ready, token, me, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** True once the account may interact (identity verified + 2FA confirmed). */
export const isFullyOnboarded = (me: Me | null) => me?.status === 'active' && me.scope === 'full';
