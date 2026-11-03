import type { ReactNode } from 'react';
import { APP_NAME } from '../../../../src/shared/constants.ts';
import { Link, useDocumentTitle } from '../../../../src/ui/router.tsx';

export function NotFoundPage(): ReactNode {
  useDocumentTitle(`Página não encontrada — ${APP_NAME}`);
  return (
    <div className="card">
      <h1>Página não encontrada</h1>
      <p>O endereço acessado não existe.</p>
      <p>
        <Link to="/">Ir para a página inicial</Link>
      </p>
    </div>
  );
}
