import { useState, type FormEvent, type ReactNode } from 'react';
import type { AdminBlockedDomain } from '../../../../src/shared/api.ts';
import { Feedback, Pagination } from '../components.tsx';
import { formatDateTime, useAdminApi } from '../session.tsx';
import { usePaged } from '../usePaged.ts';

export function DomainsPage(): ReactNode {
  const api = useAdminApi();
  const [domain, setDomain] = useState('');
  const [reason, setReason] = useState('');
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const { state, reload } = usePaged<AdminBlockedDomain>('domains', {}, page);

  async function add(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const result = await api<{ domain: string }>('domains', { domain, reason });
    if (result.ok) {
      setMessage({ kind: 'success', text: `Domínio ${result.data.domain} bloqueado (inclui subdomínios). Links existentes para ele deixam de redirecionar imediatamente.` });
      setDomain('');
      setReason('');
      reload();
    } else {
      setMessage({ kind: 'error', text: result.message });
    }
  }

  async function remove(item: AdminBlockedDomain): Promise<void> {
    if (!window.confirm(`Remover o bloqueio de ${item.domain}? Links para este domínio voltam a funcionar.`)) return;
    const result = await api(`domains/${encodeURIComponent(item.domain)}/delete`, {});
    setMessage(result.ok ? { kind: 'success', text: `Bloqueio de ${item.domain} removido.` } : { kind: 'error', text: result.message });
    reload();
  }

  return (
    <>
      <h1>Domínios bloqueados</h1>
      <p className="lead">Bloquear um domínio impede novos links e o redirecionamento de links existentes para ele e para seus subdomínios.</p>
      <form className="card" onSubmit={(e) => void add(e)}>
        <div className="row">
          <div className="field grow">
            <label htmlFor="novo-dominio">Domínio</label>
            <input id="novo-dominio" type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="exemplo.com" required maxLength={300} />
          </div>
          <div className="field grow">
            <label htmlFor="motivo-dominio">Motivo (opcional)</label>
            <input id="motivo-dominio" type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
          <div className="field">
            <button type="submit" className="button button-primary">
              Bloquear domínio
            </button>
          </div>
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
                  <th scope="col">Domínio</th>
                  <th scope="col">Motivo</th>
                  <th scope="col">Criado</th>
                  <th scope="col">Ação</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((item) => (
                  <tr key={item.domain}>
                    <td className="mono">{item.domain}</td>
                    <td>{item.reason ?? '—'}</td>
                    <td>
                      {formatDateTime(item.createdAt)}
                      <div className="hint">{item.createdBy ?? ''}</div>
                    </td>
                    <td>
                      <button type="button" className="button button-small" onClick={() => void remove(item)}>
                        Remover
                      </button>
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
