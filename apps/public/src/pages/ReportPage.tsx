import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { CreateReportRequest, CreateReportResponse } from '../../../../src/shared/api.ts';
import { APP_NAME, REPORT_REASONS, TURNSTILE_ACTIONS, type ReportReasonId } from '../../../../src/shared/constants.ts';
import { apiRequest } from '../../../../src/ui/api.ts';
import { useDocumentTitle, useLocation } from '../../../../src/ui/router.tsx';
import { TurnstileWidget } from '../../../../src/ui/Turnstile.tsx';

export function ReportPage(): ReactNode {
  useDocumentTitle(`Denunciar link — ${APP_NAME}`);
  const { search } = useLocation();
  const ids = { link: useId(), reason: useId(), details: useId(), email: useId() };
  const [link, setLink] = useState(() => search.get('link') ?? '');
  const [reason, setReason] = useState<ReportReasonId>('phishing');
  const [details, setDetails] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (link.trim() === '') {
      setError('Informe o link curto ou o código que deseja denunciar.');
      return;
    }
    if (token === null) {
      setError('Aguarde a verificação contra robôs ser concluída e tente novamente.');
      return;
    }
    setSubmitting(true);
    const body: CreateReportRequest = {
      link: link.trim(),
      reason,
      turnstileToken: token,
      ...(details.trim() ? { details: details.trim() } : {}),
      ...(email.trim() ? { contactEmail: email.trim() } : {}),
    };
    const response = await apiRequest<CreateReportResponse>('/api/reports', { body });
    setSubmitting(false);
    setToken(null);
    setResetKey((key) => key + 1);
    if (response.ok) {
      setSent(true);
    } else {
      setError(response.message);
    }
  }

  if (sent) {
    return (
      <>
        <h1>Denúncia recebida</h1>
        <div className="alert alert-success" role="status">
          Obrigado. A denúncia será analisada. Links que violam os termos podem ser bloqueados; não enviamos confirmação individual.
        </div>
        <p>
          <a href="/">Voltar para a página inicial</a>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Denunciar um link</h1>
      <p className="lead">Use este formulário para links curtos do {APP_NAME} que levem a golpes, phishing, malware, spam ou conteúdo ilegal.</p>
      <form className="card" onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor={ids.link}>Link curto ou código</label>
          <input id={ids.link} type="text" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} maxLength={2100} required placeholder="https://…/s/CODIGO" />
        </div>
        <div className="field">
          <label htmlFor={ids.reason}>Motivo</label>
          <select id={ids.reason} value={reason} onChange={(e) => setReason(e.target.value as ReportReasonId)}>
            {REPORT_REASONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.details}>Detalhes (opcional)</label>
          <textarea id={ids.details} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} aria-describedby={`${ids.details}-hint`} />
          <p id={`${ids.details}-hint`} className="hint">
            Não inclua senhas, documentos ou outros dados pessoais.
          </p>
        </div>
        <div className="field">
          <label htmlFor={ids.email}>Seu e-mail para contato (opcional)</label>
          <input id={ids.email} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
          <p className="hint">Usado apenas se precisarmos de mais informações. Veja a <a href="/privacidade">Política de Privacidade</a>.</p>
        </div>
        <TurnstileWidget action={TURNSTILE_ACTIONS.reportLink} onToken={setToken} resetKey={resetKey} />
        <div aria-live="assertive">
          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <button type="submit" className="button button-primary" disabled={submitting}>
          {submitting ? 'Enviando…' : 'Enviar denúncia'}
        </button>
      </form>
    </>
  );
}
