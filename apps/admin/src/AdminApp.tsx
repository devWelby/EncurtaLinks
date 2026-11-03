import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AdminSessionResponse } from '../../../src/shared/api.ts';
import { APP_NAME } from '../../../src/shared/constants.ts';
import { apiRequest } from '../../../src/ui/api.ts';
import { Link, navigate, useDocumentTitle, useLocation } from '../../../src/ui/router.tsx';
import { AuditPage } from './pages/AuditPage.tsx';
import { DomainsPage } from './pages/DomainsPage.tsx';
import { LegalEditorPage } from './pages/LegalEditorPage.tsx';
import { LinksPage } from './pages/LinksPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { AdminContext } from './session.tsx';

const SECTIONS = [
  { path: '/', label: 'Visão geral' },
  { path: '/links', label: 'Links' },
  { path: '/denuncias', label: 'Denúncias' },
  { path: '/dominios', label: 'Domínios bloqueados' },
  { path: '/configuracoes', label: 'Configurações' },
  { path: '/documentos', label: 'Termos e privacidade' },
  { path: '/auditoria', label: 'Auditoria' },
] as const;

function Section({ pathname }: { pathname: string }): ReactNode {
  switch (pathname) {
    case '/links':
      return <LinksPage />;
    case '/denuncias':
      return <ReportsPage />;
    case '/dominios':
      return <DomainsPage />;
    case '/configuracoes':
      return <SettingsPage />;
    case '/documentos':
      return <LegalEditorPage />;
    case '/auditoria':
      return <AuditPage />;
    default:
      return <OverviewPage />;
  }
}

type State = { status: 'loading' } | { status: 'anonymous' } | { status: 'error'; message: string } | { status: 'ready'; session: AdminSessionResponse };

export function AdminApp(): ReactNode {
  const { pathname } = useLocation();
  const [state, setState] = useState<State>({ status: 'loading' });
  const current = SECTIONS.find((s) => s.path === pathname) ?? SECTIONS[0];
  useDocumentTitle(state.status === 'ready' ? `${current.label} — Painel ${APP_NAME}` : `Painel — ${APP_NAME}`);

  const load = useCallback(async () => {
    const response = await apiRequest<AdminSessionResponse>('/api/admin/session');
    if (response.ok) setState({ status: 'ready', session: response.data });
    else if (response.status === 401) setState({ status: 'anonymous' });
    else setState({ status: 'error', message: response.message });
  }, []);

  useEffect(() => {
    let active = true;
    void apiRequest<AdminSessionResponse>('/api/admin/session').then((response) => {
      if (!active) return;
      if (response.ok) setState({ status: 'ready', session: response.data });
      else if (response.status === 401) setState({ status: 'anonymous' });
      else setState({ status: 'error', message: response.message });
    });
    return () => {
      active = false;
    };
  }, []);

  const onUnauthorized = useCallback(() => setState({ status: 'anonymous' }), []);

  async function logout(session: AdminSessionResponse): Promise<void> {
    await apiRequest('/auth/logout', { method: 'POST', csrfToken: session.csrfToken });
    setState({ status: 'anonymous' });
    navigate('/', { replace: true });
  }

  if (state.status === 'loading') {
    return (
      <main className="page" id="conteudo">
        <p role="status">Carregando…</p>
      </main>
    );
  }
  if (state.status === 'anonymous') return <LoginPage />;
  if (state.status === 'error') {
    return (
      <main className="page" id="conteudo">
        <h1>Painel indisponível</h1>
        <p className="alert alert-error" role="alert">
          {state.message}
        </p>
        <button type="button" className="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </main>
    );
  }

  const { session } = state;
  return (
    <AdminContext.Provider value={{ session, onUnauthorized }}>
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="site-header">
        <div className="inner">
          <span className="brand">
            <img className="brand-mark" src="/favicon.svg" alt="" width="28" height="28" />
            Painel {APP_NAME}
          </span>
          <span>
            <span className="hint">@{session.admin.login}</span>{' '}
            <button type="button" className="button button-small" onClick={() => void logout(session)}>
              Sair
            </button>
          </span>
        </div>
      </header>
      <main id="conteudo" className="page" tabIndex={-1}>
        <nav className="tabs" aria-label="Seções do painel">
          {SECTIONS.map((section) => (
            <Link key={section.path} to={section.path}>
              {section.label}
            </Link>
          ))}
        </nav>
        <Section pathname={pathname} />
      </main>
    </AdminContext.Provider>
  );
}
