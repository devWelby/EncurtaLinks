import type { ReactNode } from 'react';
import { APP_NAME } from '../../../src/shared/constants.ts';
import { Link, useLocation } from '../../../src/ui/router.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { LegalPage } from './pages/LegalPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { PreferencesPage } from './pages/PreferencesPage.tsx';
import { ReportPage } from './pages/ReportPage.tsx';

function Page({ pathname }: { pathname: string }): ReactNode {
  switch (pathname) {
    case '/':
      return <HomePage />;
    case '/denunciar':
      return <ReportPage />;
    case '/termos':
      return <LegalPage kind="terms" />;
    case '/privacidade':
      return <LegalPage kind="privacy" />;
    case '/preferencias':
      return <PreferencesPage />;
    default:
      return <NotFoundPage />;
  }
}

export function App(): ReactNode {
  const { pathname } = useLocation();
  return (
    <>
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="site-header">
        <div className="inner">
          <Link to="/" className="brand">
            <img className="brand-mark" src="/favicon.svg" alt="" width="28" height="28" />
            {APP_NAME}
          </Link>
          <nav className="site-nav" aria-label="Navegação principal">
            <Link to="/">Encurtar</Link>
            <Link to="/denunciar">Denunciar</Link>
            <Link to="/termos">Termos</Link>
            <Link to="/privacidade">Privacidade</Link>
            <Link to="/preferencias">Preferências</Link>
          </nav>
        </div>
      </header>
      <main id="conteudo" className="page" tabIndex={-1}>
        <Page pathname={pathname} />
      </main>
      <footer className="site-footer">
        <div className="inner">
          <span>{APP_NAME} — encurtador de links gratuito. Não verificamos nem garantimos o conteúdo dos destinos.</span>
          <span>
            <Link to="/termos">Termos de uso</Link> · <Link to="/privacidade">Privacidade</Link> · <Link to="/preferencias">Preferências de anúncios</Link>
          </span>
        </div>
      </footer>
    </>
  );
}
