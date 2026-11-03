import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { TEST_ANTIBOT_TOKEN } from '../shared/constants.ts';

/**
 * Widget do Cloudflare Turnstile (proteção contra automação).
 * - A validação real acontece no servidor; aqui só obtemos o token.
 * - O script da Cloudflare só é carregado quando o formulário é exibido.
 * - Em desenvolvimento local/testes (VITE_ANTIBOT_MODE=test), não carrega
 *   nada e fornece o token de teste, que o servidor só aceita localmente.
 */

interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('turnstile'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export const antibotMode: 'turnstile' | 'test' = import.meta.env.VITE_ANTIBOT_MODE === 'test' ? 'test' : 'turnstile';
const siteKey: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';

interface Props {
  action: string;
  onToken: (token: string | null) => void;
  /** Incrementar para obter um novo token (os tokens valem uma única vez). */
  resetKey: number;
}

export function TurnstileWidget({ action, onToken, resetKey }: Props): ReactNode {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Guarda em qual "rodada" (resetKey) houve falha; uma nova rodada limpa o aviso.
  const [failedRound, setFailedRound] = useState<number | null>(null);
  const failed = failedRound === resetKey;
  const emit = useEffectEvent((token: string | null) => onToken(token));

  useEffect(() => {
    if (antibotMode === 'test') {
      emit(TEST_ANTIBOT_TOKEN);
      return;
    }
    let cancelled = false;
    loadScript()
      .then((api) => {
        if (cancelled || !container.current) return;
        if (widgetId.current !== null) api.remove(widgetId.current);
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          action,
          language: 'pt-br',
          appearance: 'interaction-only',
          callback: (token: string) => emit(token),
          'expired-callback': () => emit(null),
          'error-callback': () => {
            emit(null);
            setFailedRound(resetKey);
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailedRound(resetKey);
      });
    return () => {
      cancelled = true;
    };
  }, [action, resetKey]);

  if (antibotMode === 'test') {
    return <p className="hint">Verificação contra robôs simulada (ambiente local de teste).</p>;
  }
  return (
    <div>
      <div ref={container} />
      {failed && (
        <p className="alert alert-warning" role="alert">
          Não foi possível carregar a verificação contra robôs. Desative bloqueadores para challenges.cloudflare.com ou tente novamente mais tarde.
        </p>
      )}
    </div>
  );
}
