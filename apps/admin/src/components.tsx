import type { ReactNode } from 'react';

export function Pagination({ page, hasMore, onPage }: { page: number; hasMore: boolean; onPage: (page: number) => void }): ReactNode {
  return (
    <nav className="pagination" aria-label="Paginação">
      <button type="button" className="button button-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </button>
      <span>Página {page}</span>
      <button type="button" className="button button-small" disabled={!hasMore} onClick={() => onPage(page + 1)}>
        Próxima
      </button>
    </nav>
  );
}

export function Feedback({ message }: { message: { kind: 'error' | 'success'; text: string } | null }): ReactNode {
  return (
    <div aria-live="polite">
      {message && (
        <p className={`alert ${message.kind === 'error' ? 'alert-error' : 'alert-success'}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  blocked: 'Bloqueado',
  deleted: 'Excluído',
  open: 'Aberta',
  resolved: 'Resolvida',
  dismissed: 'Descartada',
};

export function StatusBadge({ status }: { status: string }): ReactNode {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}
