import type { ReactNode } from 'react';
import { APP_NAME } from '../../../../src/shared/constants.ts';

const ERRORS: Record<string, string> = {
  nao_autorizado: 'Esta conta do GitHub não está autorizada a acessar o painel.',
  sem_2fa: 'A conta do GitHub precisa ter a verificação em duas etapas (2FA) ativada.',
  sessao_expirada: 'O login demorou demais ou foi iniciado em outra aba. Tente novamente.',
  falha_no_login: 'Não foi possível concluir o login com o GitHub. Tente novamente.',
  nao_configurado: 'O login com GitHub ainda não foi configurado neste ambiente.',
  indisponivel: 'O serviço está temporariamente indisponível. Tente novamente em instantes.',
};

export function LoginPage(): ReactNode {
  const code = new URLSearchParams(window.location.search).get('erro');
  const message = code !== null ? (ERRORS[code] ?? 'Não foi possível entrar.') : null;
  return (
    <main className="page" id="conteudo">
      <h1>Painel do {APP_NAME}</h1>
      <div className="card">
        <p>Acesso restrito aos administradores autorizados.</p>
        {message && (
          <p className="alert alert-error" role="alert">
            {message}
          </p>
        )}
        <a className="button button-primary" href="/auth/github/start">
          Entrar com GitHub
        </a>
        <p className="hint">É exigida conta do GitHub com verificação em duas etapas. A sessão expira após inatividade.</p>
      </div>
    </main>
  );
}
