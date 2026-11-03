import { useEffect, useState, type ReactNode } from 'react';
import type { LegalDocumentResponse } from '../../../../src/shared/api.ts';
import { APP_NAME } from '../../../../src/shared/constants.ts';
import { apiRequest } from '../../../../src/ui/api.ts';
import { LegalText } from '../../../../src/ui/LegalText.tsx';
import { useDocumentTitle } from '../../../../src/ui/router.tsx';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; doc: LegalDocumentResponse };

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }): ReactNode {
  const fallbackTitle = kind === 'terms' ? 'Termos de uso' : 'Política de Privacidade';
  const [state, setState] = useState<State>({ status: 'loading' });
  useDocumentTitle(`${state.status === 'ready' ? state.doc.title : fallbackTitle} — ${APP_NAME}`);

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<LegalDocumentResponse>(`/api/legal/${kind}`, { signal: controller.signal }).then((response) => {
      if (controller.signal.aborted) return;
      setState(response.ok ? { status: 'ready', doc: response.data } : { status: 'error', message: response.message });
    });
    return () => controller.abort();
  }, [kind]);

  if (state.status === 'loading') {
    return (
      <>
        <h1>{fallbackTitle}</h1>
        <p role="status">Carregando…</p>
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <>
        <h1>{fallbackTitle}</h1>
        <p className="alert alert-error" role="alert">
          {state.message}
        </p>
      </>
    );
  }
  const { doc } = state;
  return (
    <article className="legal">
      <h1>{doc.title}</h1>
      <p className="hint">Última atualização: {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(doc.updatedAt))}</p>
      {(doc.responsibleName || doc.responsibleContact || doc.responsibleDocument) && (
        <div className="card">
          <p>
            <strong>Responsável:</strong> {doc.responsibleName ?? 'não informado'}
            {doc.responsibleDocument ? ` (${doc.responsibleDocument})` : ''}
            <br />
            <strong>Contato:</strong> {doc.responsibleContact ?? 'não informado'}
          </p>
        </div>
      )}
      <LegalText body={doc.body} />
    </article>
  );
}
