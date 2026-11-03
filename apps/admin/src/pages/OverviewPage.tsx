import { useEffect, useState, type ReactNode } from 'react';
import type { AdminMetrics } from '../../../../src/shared/api.ts';
import { useAdminApi } from '../session.tsx';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: AdminMetrics };

export function OverviewPage(): ReactNode {
  const api = useAdminApi();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void api<AdminMetrics>('metrics?days=30').then((result) => {
      if (active) setState(result.ok ? { status: 'ready', data: result.data } : { status: 'error', message: result.message });
    });
    return () => {
      active = false;
    };
  }, [api]);

  if (state.status === 'loading') return <p role="status">Carregando métricas…</p>;
  if (state.status === 'error') return <p className="alert alert-error">{state.message}</p>;
  const { totals, days } = state.data;
  const sum = (key: 'linkCreated' | 'interstitialView' | 'continuation' | 'reportCreated' | 'linkRejected') => days.reduce((acc, d) => acc + d[key], 0);

  return (
    <>
      <h1>Visão geral</h1>
      <div className="stats">
        <div className="stat">
          <strong>{totals.activeLinks}</strong>links ativos
        </div>
        <div className="stat">
          <strong>{totals.blockedLinks}</strong>links bloqueados
        </div>
        <div className="stat">
          <strong>{totals.openReports}</strong>denúncias abertas
        </div>
        <div className="stat">
          <strong>{totals.blockedDomains}</strong>domínios bloqueados
        </div>
      </div>

      <h2>Últimos 30 dias (UTC)</h2>
      <div className="stats">
        <div className="stat">
          <strong>{sum('linkCreated')}</strong>links criados
        </div>
        <div className="stat">
          <strong>{sum('linkRejected')}</strong>criações recusadas
        </div>
        <div className="stat">
          <strong>{sum('interstitialView')}</strong>aberturas da página intermediária
        </div>
        <div className="stat">
          <strong>{sum('continuation')}</strong>continuações confirmadas
        </div>
      </div>
      <p className="hint">
        Aberturas incluem robôs de pré-visualização e não são pessoas únicas. Continuações são cliques confirmados pelo servidor (ticket consumido). Impressões e receita de
        anúncios <strong>não</strong> são medidas aqui: consulte o painel do Adsterra.
      </p>

      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">Métricas diárias</caption>
          <thead>
            <tr>
              <th scope="col">Dia</th>
              <th scope="col">Criados</th>
              <th scope="col">Recusados</th>
              <th scope="col">Aberturas</th>
              <th scope="col">Continuações</th>
              <th scope="col">Denúncias</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.day}>
                <th scope="row">{day.day}</th>
                <td>{day.linkCreated}</td>
                <td>{day.linkRejected}</td>
                <td>{day.interstitialView}</td>
                <td>{day.continuation}</td>
                <td>{day.reportCreated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
