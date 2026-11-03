import { useState, type ReactNode } from 'react';
import type { AdminAuditEntry } from '../../../../src/shared/api.ts';
import { Pagination } from '../components.tsx';
import { formatDateTime } from '../session.tsx';
import { usePaged } from '../usePaged.ts';

export function AuditPage(): ReactNode {
  const [page, setPage] = useState(1);
  const { state } = usePaged<AdminAuditEntry>('audit', {}, page);
  return (
    <>
      <h1>Auditoria</h1>
      <p className="lead">Registro das ações administrativas e automáticas (somente leitura).</p>
      {state.status === 'loading' && <p role="status">Carregando…</p>}
      {state.status === 'error' && <p className="alert alert-error">{state.message}</p>}
      {state.status === 'ready' && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Quem</th>
                  <th scope="col">Ação</th>
                  <th scope="col">Alvo</th>
                  <th scope="col">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.length === 0 && (
                  <tr>
                    <td colSpan={5}>Nenhum registro.</td>
                  </tr>
                )}
                {state.data.items.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.createdAt)}</td>
                    <td>@{entry.adminLogin}</td>
                    <td className="mono">{entry.action}</td>
                    <td className="mono">{entry.targetId ? `${entry.targetType ?? ''}:${entry.targetId}` : '—'}</td>
                    <td className="mono">{Object.keys(entry.details).length > 0 ? JSON.stringify(entry.details) : '—'}</td>
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
