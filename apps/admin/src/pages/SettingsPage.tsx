import { useEffect, useState, type ReactNode } from 'react';
import type { AdminSettings } from '../../../../src/shared/api.ts';
import { Feedback } from '../components.tsx';
import { useAdmin, useAdminApi } from '../session.tsx';

const TOGGLES: Array<{ key: keyof AdminSettings; title: string; description: string }> = [
  {
    key: 'linkCreationEnabled',
    title: 'Criação de links',
    description: 'Desligue em caso de abuso em massa. Links existentes continuam funcionando.',
  },
  {
    key: 'adsEnabled',
    title: 'Publicidade (interruptor de emergência)',
    description:
      'Só tem efeito se o site público tiver ADS_ENABLED=true e tags válidas configuradas. Desligar remove os anúncios da próxima página carregada, sem novo deploy.',
  },
  {
    key: 'reportsEnabled',
    title: 'Recebimento de denúncias',
    description: 'Desligue apenas temporariamente (ex.: ataque ao formulário).',
  },
];

export function SettingsPage(): ReactNode {
  const api = useAdminApi();
  const { session, onUnauthorized } = useAdmin();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    void api<AdminSettings>('settings').then((result) => {
      if (!active) return;
      if (result.ok) setSettings(result.data);
      else setMessage({ kind: 'error', text: result.message });
    });
    return () => {
      active = false;
    };
  }, [api]);

  async function toggle(key: keyof AdminSettings, value: boolean): Promise<void> {
    // Atualização otimista: a caixa reflete o clique na hora e volta atrás se o servidor recusar.
    const previous = settings;
    setSettings((current) => (current === null ? current : { ...current, [key]: value }));
    setMessage(null);
    const result = await api<AdminSettings>('settings', { [key]: value });
    if (result.ok) {
      setSettings(result.data);
      setMessage({ kind: 'success', text: 'Configuração salva.' });
    } else {
      setSettings(previous);
      setMessage({ kind: 'error', text: result.message });
    }
  }

  async function revokeAll(): Promise<void> {
    if (!window.confirm('Encerrar todas as suas sessões, inclusive esta?')) return;
    const result = await api<{ revoked: number }>('sessions/revoke-all', {});
    if (result.ok) onUnauthorized();
    else setMessage({ kind: 'error', text: result.message });
  }

  return (
    <>
      <h1>Configurações</h1>
      <Feedback message={message} />
      {settings === null ? (
        <p role="status">Carregando…</p>
      ) : (
        <div className="card">
          {TOGGLES.map((toggleDef) => (
            <div className="toggle" key={toggleDef.key}>
              <input
                id={`cfg-${toggleDef.key}`}
                type="checkbox"
                checked={settings[toggleDef.key]}
                onChange={(e) => void toggle(toggleDef.key, e.target.checked)}
                aria-describedby={`cfg-${toggleDef.key}-desc`}
              />
              <div>
                <label htmlFor={`cfg-${toggleDef.key}`}>
                  <strong>{toggleDef.title}</strong> — {settings[toggleDef.key] ? 'ligado' : 'desligado'}
                </label>
                <p id={`cfg-${toggleDef.key}-desc`} className="hint">
                  {toggleDef.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      <h2>Sessões</h2>
      <p>
        Conectado como <strong>@{session.admin.login}</strong>. A sessão expira em {new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', dateStyle: 'short' }).format(new Date(session.expiresAt))} ou após 30
        minutos sem uso.
      </p>
      <button type="button" className="button button-danger" onClick={() => void revokeAll()}>
        Encerrar todas as minhas sessões
      </button>
    </>
  );
}
