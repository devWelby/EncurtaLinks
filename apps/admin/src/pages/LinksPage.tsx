import { useState, type FormEvent, type ReactNode } from 'react';
import type { AdminLinkSummary } from '../../../../src/shared/api.ts';
import { Feedback, Pagination, StatusBadge } from '../components.tsx';
import { formatDateTime, useAdminApi } from '../session.tsx';
import { usePaged } from '../usePaged.ts';

const ACTIONS = {
  block: { label: 'Bloquear', confirm: 'Bloquear este link? Visitantes verão a página de link bloqueado.' },
  unblock: { label: 'Desbloquear', confirm: 'Desbloquear este link?' },
  delete: { label: 'Excluir', confirm: 'Excluir definitivamente? O destino é apagado e o código nunca será reutilizado. Esta ação não pode ser desfeita.' },
} as const;

type Action = keyof typeof ACTIONS;

export function LinksPage(): ReactNode {
  const api = useAdminApi();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState({ q: '', status: 'all' });
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const { state, reload } = usePaged<AdminLinkSummary>('links', query, page);

  function search(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setPage(1);
    setQuery((q) => ({ ...q, q: draft.trim() }));
  }

  async function act(link: AdminLinkSummary, action: Action): Promise<void> {
    if (!window.confirm(ACTIONS[action].confirm)) return;
    const reason = action === 'unblock' ? '' : (window.prompt('Motivo (opcional, fica na auditoria):') ?? '');
    const result = await api<{ status: string }>(`links/${encodeURIComponent(link.slug)}/${action}`, { reason });
    setMessage(result.ok ? { kind: 'success', text: `Link ${link.slug}: ação "${ACTIONS[action].label}" concluída.` } : { kind: 'error', text: result.message });
    reload();
  }

  return (
    <>
      <h1>Links</h1>
      <form className="row card" onSubmit={search} role="search">
        <div className="field grow">
          <label htmlFor="busca-links">Buscar por código ou domínio</label>
          <input id="busca-links" type="search" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="filtro-status">Situação</label>
          <select
            id="filtro-status"
            value={query.status}
            onChange={(e) => {
              setPage(1);
              setQuery((q) => ({ ...q, status: e.target.value }));
            }}
          >
            <option value="all">Todas</option>
            <option value="active">Ativos</option>
            <option value="blocked">Bloqueados</option>
            <option value="deleted">Excluídos</option>
          </select>
        </div>
        <div className="field">
          <button type="submit" className="button button-primary">
            Buscar
          </button>
        </div>
      </form>
      <Feedback message={message} />
      {state.status === 'loading' && <p role="status">Carregando…</p>}
      {state.status === 'error' && <p className="alert alert-error">{state.message}</p>}
      {state.status === 'ready' && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Destino</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Criado / expira</th>
                  <th scope="col">Aberturas / continuações</th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.length === 0 && (
                  <tr>
                    <td colSpan={6}>Nenhum link encontrado.</td>
                  </tr>
                )}
                {state.data.items.map((link) => (
                  <tr key={link.slug}>
                    <td className="mono">{link.slug}</td>
                    <td>
                      <strong>{link.destinationHost ?? '—'}</strong>
                      {link.destinationUrl && <div className="mono hint">{link.destinationUrl}</div>}
                      {link.statusReason && <div className="hint">Motivo: {link.statusReason}</div>}
                    </td>
                    <td>
                      <StatusBadge status={link.status} />
                      {link.expired && <div className="hint">expirado</div>}
                      {link.openReports > 0 && <div className="hint">{link.openReports} denúncia(s) aberta(s)</div>}
                    </td>
                    <td>
                      {formatDateTime(link.createdAt)}
                      <div className="hint">{link.expiresAt ? formatDateTime(link.expiresAt) : 'sem expiração'}</div>
                    </td>
                    <td>
                      {link.interstitialViews} / {link.continuations}
                    </td>
                    <td>
                      <div className="row">
                        {link.status === 'active' && (
                          <button type="button" className="button button-small" onClick={() => void act(link, 'block')}>
                            Bloquear
                          </button>
                        )}
                        {link.status === 'blocked' && (
                          <button type="button" className="button button-small" onClick={() => void act(link, 'unblock')}>
                            Desbloquear
                          </button>
                        )}
                        {link.status !== 'deleted' && (
                          <button type="button" className="button button-small button-danger" onClick={() => void act(link, 'delete')}>
                            Excluir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={state.data.page} hasMore={state.data.hasMore} onPage={setPage} />
        </>
      )}
    </>
  );
}
