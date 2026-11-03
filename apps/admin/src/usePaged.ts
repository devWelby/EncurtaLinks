import { useCallback, useEffect, useState } from 'react';
import type { Paginated } from '../../../src/shared/api.ts';
import { useAdminApi } from './session.tsx';

type State<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Paginated<T> };

/** Carrega uma listagem paginada da API administrativa. */
export function usePaged<T>(path: string, query: Record<string, string>, page: number): { state: State<T>; reload: () => void } {
  const api = useAdminApi();
  const [state, setState] = useState<State<T>>({ status: 'loading' });
  const [version, setVersion] = useState(0);
  const params = new URLSearchParams({ ...query, page: String(page) }).toString();

  useEffect(() => {
    let active = true;
    void api<Paginated<T>>(`${path}?${params}`).then((result) => {
      if (!active) return;
      setState(result.ok ? { status: 'ready', data: result.data } : { status: 'error', message: result.message });
    });
    return () => {
      active = false;
    };
  }, [api, path, params, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { state, reload };
}
