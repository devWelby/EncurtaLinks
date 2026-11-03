import type { ReactNode } from 'react';
import { APP_NAME, CONSENT_COOKIE } from '../../../../src/shared/constants.ts';
import { useDocumentTitle } from '../../../../src/ui/router.tsx';

function readConsent(): 'granted' | 'denied' | null {
  const match = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
  const value = match?.slice(CONSENT_COOKIE.length + 1);
  return value === 'granted' || value === 'denied' ? value : null;
}

/** Preferências de publicidade. Os formulários funcionam sem JavaScript (POST /consent). */
export function PreferencesPage(): ReactNode {
  useDocumentTitle(`Preferências de anúncios — ${APP_NAME}`);
  const consent = readConsent();
  const label = consent === 'granted' ? 'Anúncios permitidos' : consent === 'denied' ? 'Anúncios recusados' : 'Nenhuma escolha registrada';

  return (
    <>
      <h1>Preferências de anúncios</h1>
      <p className="lead">
        A página intermediária dos links pode exibir anúncios do Adsterra, sempre identificados como “Publicidade” e abaixo do botão de continuar. Os scripts de anúncio só são
        carregados depois da sua permissão.
      </p>
      <div className="card">
        <p role="status">
          Situação atual neste navegador: <strong>{label}</strong>
        </p>
        <div className="row">
          <form method="post" action="/consent">
            <input type="hidden" name="choice" value="granted" />
            <input type="hidden" name="return" value="/preferencias" />
            <button type="submit" className="button button-primary">
              Permitir anúncios
            </button>
          </form>
          <form method="post" action="/consent">
            <input type="hidden" name="choice" value="denied" />
            <input type="hidden" name="return" value="/preferencias" />
            <button type="submit" className="button">
              Recusar anúncios
            </button>
          </form>
        </div>
        <p className="hint">
          Recusar não impede o uso dos links. A escolha fica salva em um cookie deste site por até 180 dias; você pode alterá-la aqui a qualquer momento. Veja a{' '}
          <a href="/privacidade">Política de Privacidade</a>.
        </p>
      </div>
      <h2>Outros serviços</h2>
      <p>
        A verificação contra robôs dos formulários usa o Cloudflare Turnstile, necessário para a segurança do serviço. Ela é carregada somente nas páginas de criação de link e
        de denúncia.
      </p>
    </>
  );
}
