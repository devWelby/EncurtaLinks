import { useCallback, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

/**
 * Roteador mínimo baseado na History API (sem dependências).
 * As rotas do navegador correspondem às rotas explícitas do netlify.toml.
 */

const listeners = new Set<() => void>();

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  for (const listener of listeners) listener();
  window.scrollTo(0, 0);
}

export interface Location {
  pathname: string;
  search: URLSearchParams;
}

function current(): Location {
  return { pathname: window.location.pathname.replace(/\/+$/, '') || '/', search: new URLSearchParams(window.location.search) };
}

export function useLocation(): Location {
  const [location, setLocation] = useState<Location>(current);
  useEffect(() => {
    const update = (): void => setLocation(current());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return location;
}

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
  children: ReactNode;
}

export function Link({ to, children, onClick, ...rest }: LinkProps): ReactNode {
  const location = useLocation();
  const handle = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(to);
    },
    [onClick, to],
  );
  const path = to.split('?')[0];
  return (
    <a href={to} onClick={handle} aria-current={location.pathname === path ? 'page' : undefined} {...rest}>
      {children}
    </a>
  );
}

/** Atualiza o título da aba (importante para leitores de tela ao navegar). */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
