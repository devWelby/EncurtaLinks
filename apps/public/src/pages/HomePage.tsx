import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CreateLinkRequest, CreateLinkResponse } from '../../../../src/shared/api.ts';
import { APP_NAME, DEFAULT_EXPIRY, EXPIRY_OPTIONS, TURNSTILE_ACTIONS, type ExpiryOptionId } from '../../../../src/shared/constants.ts';
import { apiRequest } from '../../../../src/ui/api.ts';
import { useDocumentTitle } from '../../../../src/ui/router.tsx';
import { TurnstileWidget } from '../../../../src/ui/Turnstile.tsx';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));
}

export function HomePage(): ReactNode {
  useDocumentTitle(`${APP_NAME} — encurtador de links gratuito`);
  const urlId = useId();
  const expiryId = useId();
  const errorId = useId();
  const [url, setUrl] = useState('');
  const [expiresIn, setExpiresIn] = useState<ExpiryOptionId>(DEFAULT_EXPIRY);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateLinkResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const resultInput = useRef<HTMLInputElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setCopied(false);
    const trimmed = url.trim();
    if (trimmed === '') {
      setError('Informe o endereço que deseja encurtar.');
      urlInput.current?.focus();
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      setError('O endereço deve começar com https:// ou http://.');
      urlInput.current?.focus();
      return;
    }
    if (token === null) {
      setError('Aguarde a verificação contra robôs ser concluída e tente novamente.');
      return;
    }
    setSubmitting(true);
    const body: CreateLinkRequest = { url: trimmed, expiresIn, turnstileToken: token };
    const response = await apiRequest<CreateLinkResponse>('/api/links', { body });
    setSubmitting(false);
    // Tokens do desafio valem uma única vez: pede um novo após cada envio.
    setToken(null);
    setResetKey((key) => key + 1);
    if (response.ok) {
      setResult(response.data);
      setUrl('');
      requestAnimationFrame(() => resultInput.current?.focus());
    } else {
      setResult(null);
      setError(
        response.status === 429 && response.retryAfterSeconds
          ? `Muitas tentativas. Tente novamente em ${response.retryAfterSeconds} segundo(s).`
          : response.message,
      );
      urlInput.current?.focus();
    }
  }

  async function copy(): Promise<void> {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.shortUrl);
      setCopied(true);
    } catch {
      resultInput.current?.select();
      setCopied(false);
      setError('Não foi possível copiar automaticamente. O link foi selecionado: use Ctrl+C (ou toque e segure para copiar).');
    }
  }

  return (
    <>
      <h1>Encurte um link, de graça</h1>
      <p className="lead">
        Sem cadastro. Quem abrir o link curto verá primeiro o domínio de destino e um botão para continuar. A página intermediária pode exibir publicidade identificada, que mantém o serviço gratuito.
      </p>

      <form className="card" onSubmit={(event) => void submit(event)} noValidate aria-describedby={error ? errorId : undefined}>
        <div className="field">
          <label htmlFor={urlId}>Endereço (URL) a encurtar</label>
          <input
            ref={urlInput}
            id={urlId}
            name="url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://exemplo.com/pagina"
            maxLength={2048}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-invalid={error !== null}
            required
          />
          <p className="hint">Apenas endereços http(s) públicos. Endereços locais, IPs e outros encurtadores não são aceitos.</p>
        </div>
        <div className="row">
          <div className="field grow">
            <label htmlFor={expiryId}>Validade do link</label>
            <select id={expiryId} name="expiresIn" value={expiresIn} onChange={(event) => setExpiresIn(event.target.value as ExpiryOptionId)}>
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <button type="submit" className="button button-primary" disabled={submitting} aria-disabled={submitting}>
              {submitting ? 'Encurtando…' : 'Encurtar link'}
            </button>
          </div>
        </div>
        <TurnstileWidget action={TURNSTILE_ACTIONS.createLink} onToken={setToken} resetKey={resetKey} />
        <p className="hint">
          Ao encurtar, você concorda com os <a href="/termos">Termos de uso</a>. O destino não pode ser alterado depois.
        </p>
        <div aria-live="assertive">
          {error && (
            <p id={errorId} className="alert alert-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </form>

      <div aria-live="polite">
        {result && (
          <section className="card" aria-labelledby="resultado-titulo">
            <h2 id="resultado-titulo">Seu link curto está pronto</h2>
            <div className="row">
              <div className="field grow">
                <label htmlFor="link-curto">Link curto</label>
                <input ref={resultInput} id="link-curto" className="result-url" type="text" readOnly value={result.shortUrl} onFocus={(event) => event.target.select()} />
              </div>
              <div className="field">
                <button type="button" className="button button-primary" onClick={() => void copy()}>
                  {copied ? 'Copiado!' : 'Copiar link'}
                </button>
              </div>
            </div>
            <p className="visually-hidden" role="status">
              {copied ? 'Link copiado para a área de transferência.' : ''}
            </p>
            <p>
              Destino: <strong>{result.destinationHost}</strong>
              {result.expiresAt ? ` · expira em ${formatDate(result.expiresAt)}` : ' · sem expiração'}
            </p>
            <p className="hint">
              Guarde o link: não há listagem pública nem edição do destino. <a href={result.shortUrl}>Abrir o link curto</a>
            </p>
          </section>
        )}
      </div>

      <section aria-labelledby="como-funciona">
        <h2 id="como-funciona">Como funciona</h2>
        <ul>
          <li>O link curto leva a uma página do {APP_NAME} que mostra o domínio de destino antes de continuar.</li>
          <li>Links usados para golpes, malware ou spam podem ser bloqueados. <a href="/denunciar">Denuncie um link</a>.</li>
          <li>O {APP_NAME} não analisa nem garante o conteúdo dos sites de destino.</li>
        </ul>
      </section>
    </>
  );
}
