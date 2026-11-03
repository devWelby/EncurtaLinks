import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { LegalDocumentResponse } from '../../../../src/shared/api.ts';
import { LegalText } from '../../../../src/ui/LegalText.tsx';
import { Feedback } from '../components.tsx';
import { formatDateTime, useAdminApi } from '../session.tsx';

interface Draft {
  title: string;
  body: string;
  responsibleName: string;
  responsibleContact: string;
  responsibleDocument: string;
}

const toDraft = (doc: LegalDocumentResponse): Draft => ({
  title: doc.title,
  body: doc.body,
  responsibleName: doc.responsibleName ?? '',
  responsibleContact: doc.responsibleContact ?? '',
  responsibleDocument: doc.responsibleDocument ?? '',
});

export function LegalEditorPage(): ReactNode {
  const api = useAdminApi();
  const [kind, setKind] = useState<'terms' | 'privacy'>('terms');
  const [doc, setDoc] = useState<LegalDocumentResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void api<LegalDocumentResponse>(`legal/${kind}`).then((result) => {
      if (!active) return;
      if (result.ok) {
        setDoc(result.data);
        setDraft(toDraft(result.data));
        setMessage(null);
      } else {
        setMessage({ kind: 'error', text: result.message });
      }
    });
    return () => {
      active = false;
    };
  }, [api, kind]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (draft === null) return;
    setSaving(true);
    const result = await api<LegalDocumentResponse>(`legal/${kind}`, draft);
    setSaving(false);
    if (result.ok) {
      setDoc(result.data);
      setDraft(toDraft(result.data));
      setMessage({ kind: 'success', text: 'Documento salvo. O site público pode levar até 5 minutos para exibir a nova versão (cache).' });
    } else {
      setMessage({ kind: 'error', text: result.message });
    }
  }

  const set = (field: keyof Draft) => (value: string) => setDraft((d) => (d === null ? d : { ...d, [field]: value }));

  return (
    <>
      <h1>Termos de uso e privacidade</h1>
      <p className="alert alert-warning">
        Os textos iniciais são modelos e contêm campos <strong>[PREENCHER]</strong>. Revise-os com orientação jurídica adequada antes de publicar o serviço. O sistema não
        garante conformidade legal.
      </p>
      <div className="field">
        <label htmlFor="doc-tipo">Documento</label>
        <select id="doc-tipo" value={kind} onChange={(e) => setKind(e.target.value as 'terms' | 'privacy')}>
          <option value="terms">Termos de uso</option>
          <option value="privacy">Política de Privacidade</option>
        </select>
      </div>
      <Feedback message={message} />
      {draft !== null && doc !== null && (
        <form className="card" onSubmit={(e) => void save(e)}>
          <p className="hint">Última alteração: {formatDateTime(doc.updatedAt)}</p>
          <div className="field">
            <label htmlFor="doc-titulo">Título</label>
            <input id="doc-titulo" type="text" value={draft.title} onChange={(e) => set('title')(e.target.value)} maxLength={200} required />
          </div>
          <div className="row">
            <div className="field grow">
              <label htmlFor="doc-resp">Responsável (nome ou razão social)</label>
              <input id="doc-resp" type="text" value={draft.responsibleName} onChange={(e) => set('responsibleName')(e.target.value)} maxLength={200} />
            </div>
            <div className="field grow">
              <label htmlFor="doc-contato">Contato do responsável</label>
              <input id="doc-contato" type="text" value={draft.responsibleContact} onChange={(e) => set('responsibleContact')(e.target.value)} maxLength={300} />
            </div>
            <div className="field grow">
              <label htmlFor="doc-documento">Documento (CPF/CNPJ, opcional)</label>
              <input id="doc-documento" type="text" value={draft.responsibleDocument} onChange={(e) => set('responsibleDocument')(e.target.value)} maxLength={100} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="doc-corpo">Texto</label>
            <textarea id="doc-corpo" rows={18} value={draft.body} onChange={(e) => set('body')(e.target.value)} maxLength={100_000} required aria-describedby="doc-corpo-dica" />
            <p id="doc-corpo-dica" className="hint">
              Formato: linhas iniciadas por “# ” viram títulos, “- ” viram itens de lista; linha em branco separa parágrafos. HTML não é interpretado.
            </p>
          </div>
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar documento'}
          </button>
          <h2>Pré-visualização</h2>
          <div className="legal">
            <LegalText body={draft.body} />
          </div>
        </form>
      )}
    </>
  );
}
