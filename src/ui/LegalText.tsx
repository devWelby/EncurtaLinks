import type { ReactNode } from 'react';

/**
 * Renderiza o texto dos documentos legais (formato simples: "# " e "## "
 * para títulos, "- " para itens de lista, linhas em branco separam
 * parágrafos). Gera elementos React — nunca HTML bruto —, então o conteúdo
 * editado no painel não executa scripts.
 */
export function LegalText({ body }: { body: string }): ReactNode {
  const blocks: ReactNode[] = [];
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push(<p key={`p${blocks.length}`}>{paragraph.join(' ')}</p>);
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list.length > 0) {
      blocks.push(
        <ul key={`ul${blocks.length}`}>
          {list.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else if (line.startsWith('## ')) {
      flushParagraph();
      flushList();
      blocks.push(<h3 key={`h${blocks.length}`}>{line.slice(3)}</h3>);
    } else if (line.startsWith('# ')) {
      flushParagraph();
      flushList();
      blocks.push(<h2 key={`h${blocks.length}`}>{line.slice(2)}</h2>);
    } else if (/^\s*-\s+/.test(line)) {
      flushParagraph();
      list.push(line.replace(/^\s*-\s+/, ''));
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return <>{blocks}</>;
}
