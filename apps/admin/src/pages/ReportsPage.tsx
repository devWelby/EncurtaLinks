import { useState, type ReactNode } from 'react';
import type { AdminReport } from '../../../../src/shared/api.ts';
import { REPORT_REASONS } from '../../../../src/shared/constants.ts';
import { Feedback, Pagination, StatusBadge } from '../components.tsx';
import { formatDateTime, useAdminApi } from '../session.tsx';
import { usePaged } from '../usePaged.ts';

const reasonLabel = (id: string): string => REPORT_REASONS.find((r) => r.id === id)?.label ?? id;

export function ReportsPage(): ReactNode {
  const api = useAdminApi();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const { state, reload } = usePaged<AdminReport>('reports', { status }, page);

  async function handle(report: AdminReport, action: 'resolve' | 'dismiss', blockLink: boolean): Promise<void> {
    const question = blockLink ? `Resolver a denúncia #${report.id} e bloquear o link ${report.slug}?` : action === 'resolve' ? `Marcar a denúncia #${report.id} como resolvida?` : `Descartar a denúncia #${report.id}?`;
    if (!window.confirm(question)) return;
    const note = window.prompt('Observação (opcional):') ?? '';
    const result = await api<{ linkBlocked: boolean }>(`reports/${report.id}/${action}`, { note, blockLink });
    setMessage(
      result.ok
        ? { kind: 'success', text: `Denúncia #${report.id} ${action === 'resolve' ? 'resolvida' : 'descartada'}${result.data.linkBlocked ? ' e link bloqueado' : ''}.` }
        : { kind: 'error', text: result.message },
    );
    reload();
  }

  return (
    <>
      <h1>Denúncias</h1>
      <div className="field">
        <label htmlFor="filtro-denuncias">Situação</label>
        <select
          id="filtro-denuncias"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="open">Abertas</option>
          <option value="resolved">Resolvidas</option>
          <option value="dismissed">Descartadas</option>
          <option value="all">Todas</option>
        </select>
      </div>
      <Feedback message={message} />
      {state.status === 'loading' && <p role="status">Carregando…</p>}
      {state.status === 'error' && <p className="alert alert-error">{state.message}</p>}
      {state.status === 'ready' && (
        <>
          {state.data.items.length === 0 && <p>Nenhuma denúncia nesta situação.</p>}
          {state.data.items.map((report) => (
            <article key={report.id} className="card" aria-labelledby={`den-${report.id}`}>
              <h2 id={`den-${report.id}`}>
                #{report.id} — {reasonLabel(report.reason)} <StatusBadge status={report.status} />
              </h2>
              <p>
                Link <span className="mono">{report.slug}</span> → <strong>{report.destinationHost ?? '—'}</strong>{' '}
                {report.linkStatus && <StatusBadge status={report.linkStatus} />}
              </p>
              {report.details && <p className="hint">“{report.details}”</p>}
              <p className="hint">
                Recebida em {formatDateTime(report.createdAt)}
                {report.contactEmail ? ` · contato: ${report.contactEmail}` : ''}
                {report.resolvedAt ? ` · tratada em ${formatDateTime(report.resolvedAt)} por ${report.resolvedBy ?? '—'}` : ''}
                {report.resolutionNote ? ` · ${report.resolutionNote}` : ''}
              </p>
              {report.status === 'open' && (
                <div className="row">
                  {report.linkStatus === 'active' && (
                    <button type="button" className="button button-small button-danger" onClick={() => void handle(report, 'resolve', true)}>
                      Resolver e bloquear link
                    </button>
                  )}
                  <button type="button" className="button button-small" onClick={() => void handle(report, 'resolve', false)}>
                    Marcar como resolvida
                  </button>
                  <button type="button" className="button button-small" onClick={() => void handle(report, 'dismiss', false)}>
                    Descartar
                  </button>
                </div>
              )}
            </article>
          ))}
          <Pagination page={state.data.page} hasMore={state.data.hasMore} onPage={setPage} />
        </>
      )}
    </>
  );
}
