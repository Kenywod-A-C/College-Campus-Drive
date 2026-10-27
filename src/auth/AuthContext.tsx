import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Permission, User } from '@/types';
import { authApi } from '@/api';

interface AuthCtx {
  user: User | null;
  permissions: Permission[];
  loading: boolean;
  login: (identifier: string, password: string, remember: boolean) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (p: Permission) => boolean;
}
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);

  const apply = (p: { user: User; permissions: Permission[] } | null) => { setUser(p?.user ?? null); setPermissions(p?.permissions ?? []); };
  const refresh = useCallback(async () => { apply(await authApi.me()); }, []);

  useEffect(() => { refresh().finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => {
    const onUnauthorized = () => { authApi.logout().finally(() => apply(null)); };
    window.addEventListener('ca:unauthorized', onUnauthorized);
    return () => window.removeEventListener('ca:unauthorized', onUnauthorized);
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    user, permissions, loading,
    login: async (id, pw, remember) => { const p = await authApi.login(id, pw, remember); apply(p); return p.user; },
    // Local state is always cleared, even if the server call fails (e.g. offline): the user asked to sign out.
    logout: async () => { try { await authApi.logout(); } catch { /* server unreachable: still sign out locally */ } finally { apply(null); } },
    refresh,
    can: (p) => permissions.includes(p),
  }), [user, permissions, loading, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
