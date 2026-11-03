import { createContext, useCallback, useContext } from 'react';
import type { AdminSessionResponse } from '../../../src/shared/api.ts';
import { apiRequest, type ApiResult } from '../../../src/ui/api.ts';

/**
 * Sessão do painel: o cookie é HttpOnly (inacessível aqui); o token CSRF
 * fica apenas em memória (nada em localStorage/sessionStorage).
 */
export interface AdminContextValue {
  session: AdminSessionResponse;
  onUnauthorized: () => void;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (value === null) throw new Error('AdminContext ausente');
  return value;
}

/** Chamada à API administrativa com CSRF; 401 leva de volta ao login. */
export function useAdminApi(): <T>(path: string, body?: unknown) => Promise<ApiResult<T>> {
  const { session, onUnauthorized } = useAdmin();
  const csrfToken = session.csrfToken;
  return useCallback(
    async <T,>(path: string, body?: unknown): Promise<ApiResult<T>> => {
      const result = await apiRequest<T>(`/api/admin/${path}`, body === undefined ? {} : { body, csrfToken });
      if (!result.ok && result.status === 401) onUnauthorized();
      return result;
    },
    [csrfToken, onUnauthorized],
  );
}

export function formatDateTime(iso: string | null): string {
  if (iso === null) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}
