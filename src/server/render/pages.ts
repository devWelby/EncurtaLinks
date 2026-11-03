import { APP_NAME } from '../../shared/constants.ts';
import type { AdSlot, AdsCspSources } from '../ads/adsterra.ts';
import { html, trustedHtml, type SafeHtml } from './html.ts';
import { INTERSTITIAL_CSS, INTERSTITIAL_SCRIPT } from './styles.ts';

export type AdArea =
  | { kind: 'none' }
  | { kind: 'placeholder' }
  | { kind: 'consent'; returnPath: string }
  | { kind: 'declined' }
  | { kind: 'slots'; slots: AdSlot[] };

export interface InterstitialView {
  slug: string;
  ticket: string;
  destinationUrl: string;
  destinationHost: string;
  unicodeHost: string | null;
  expiresAt: Date | null;
  notice: string | null;
  minWaitSeconds: number;
  ads: AdArea;
}

/**
 * Política CSP da página intermediária.
 * - Sem anúncios: somente o CSS/JS inline com nonce.
 * - Com anúncios: libera apenas os hashes/origens derivados das tags
 *   configuradas e as origens extras declaradas pelo proprietário.
 * - form-action precisa permitir http(s) porque o POST de continuação
 *   responde com 303 para o destino (navegadores aplicam form-action ao
 *   redirecionamento).
 */
export function interstitialCsp(nonce: string, ads: AdsCspSources | null): string {
  const join = (values: string[]): string => (values.length > 0 ? ` ${values.join(' ')}` : '');
  const directives = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'${ads ? join(ads.scriptSrc) : ''}`,
    ads ? `style-src 'self' 'unsafe-inline'${join(ads.styleSrc)}` : `style-src 'nonce-${nonce}'`,
    `img-src 'self' data:${ads ? ` https:${join(ads.imgSrc)}` : ''}`,
    `frame-src ${ads && ads.frameSrc.length > 0 ? ads.frameSrc.join(' ') : "'none'"}`,
    `connect-src 'self'${ads ? join(ads.connectSrc) : ''}`,
    "font-src 'self'",
    "form-action 'self' https: http:",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ];
  return directives.join('; ');
}

export function statusPageCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function layout(options: { nonce: string; title: string; body: SafeHtml; bodyAttributes?: SafeHtml; script?: boolean }): string {
  return html`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${options.title}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style nonce="${options.nonce}">${trustedHtml(INTERSTITIAL_CSS)}</style>
</head>
<body${options.bodyAttributes ?? ''}>
<a class="skip" href="#conteudo">Pular para o conteúdo</a>
<div class="wrap">
<header class="site-header"><a class="brand" href="/">${APP_NAME}</a></header>
${options.body}
<footer>
<nav aria-label="Rodapé">
<a href="/">Criar link curto</a>
<a href="/denunciar">Denunciar link</a>
<a href="/termos">Termos de uso</a>
<a href="/privacidade">Privacidade</a>
<a href="/preferencias">Preferências de anúncios</a>
</nav>
</footer>
</div>
${options.script ? html`<script nonce="${options.nonce}">${trustedHtml(INTERSTITIAL_SCRIPT)}</script>` : ''}
</body>
</html>`.value;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(date);
}

function renderAdArea(ads: AdArea): SafeHtml {
  switch (ads.kind) {
    case 'none':
      return html``;
    case 'placeholder':
      return html`<aside class="ad-area" aria-label="Publicidade">
<p class="ad-label">Publicidade</p>
<div class="ad-placeholder" data-ad-placeholder>Espaço publicitário simulado (somente desenvolvimento).<br>Nenhum anúncio real é carregado.</div>
</aside>`;
    case 'consent':
      return html`<aside class="ad-area" aria-label="Publicidade">
<p class="ad-label">Publicidade</p>
<div class="consent">
<p>Os anúncios ajudam a manter o ${APP_NAME} gratuito. Você permite exibir anúncios do Adsterra nesta página? O provedor de anúncios pode usar cookies e tratar dados conforme a <a href="https://adsterra.com/privacy-policy-managed/" rel="noopener noreferrer">política dele</a>.</p>
<form method="post" action="/consent" class="consent-actions">
<input type="hidden" name="return" value="${ads.returnPath}">
<button class="button button-secondary" type="submit" name="choice" value="granted">Permitir anúncios</button>
<button class="button button-secondary" type="submit" name="choice" value="denied">Não permitir</button>
</form>
<p class="warning">Sua escolha não afeta o acesso ao destino.</p>
</div>
</aside>`;
    case 'declined':
      return html`<aside class="ad-area" aria-label="Publicidade">
<p class="ad-label">Publicidade</p>
<p class="warning">Você optou por não ver anúncios. <a href="/preferencias">Alterar preferência</a></p>
</aside>`;
    case 'slots':
      return html`<aside class="ad-area" aria-label="Publicidade">
<p class="ad-label">Publicidade</p>
${ads.slots.map((slot) => html`<div class="ad-slot" data-ad-slot="${slot.id}">${trustedHtml(slot.html)}</div>`)}
</aside>`;
  }
}

export function renderInterstitial(view: InterstitialView, nonce: string): string {
  const destinationLabel = view.destinationHost;
  const body = html`<main id="conteudo" class="card">
<h1>Você está saindo do ${APP_NAME}</h1>
<p class="lead">Este link curto leva para o domínio:</p>
<p class="destination" data-destination-host>${destinationLabel}</p>
${
  view.unicodeHost !== null
    ? html`<p class="idn" role="note">Este é um domínio internacionalizado, exibido como <strong>${view.unicodeHost}</strong>. Confira com atenção: letras de alfabetos diferentes podem parecer iguais.</p>`
    : ''
}
<details>
<summary>Ver endereço completo</summary>
<p class="full-url">${view.destinationUrl}</p>
</details>
${view.notice !== null ? html`<p class="notice" role="status">${view.notice}</p>` : ''}
<form method="post" action="/s/${view.slug}/continue" class="continue-form" id="continue-form">
<input type="hidden" name="ticket" value="${view.ticket}">
<button type="submit" id="continuar" class="button button-primary">Continuar para ${destinationLabel}</button>
</form>
${view.minWaitSeconds > 0 ? html`<p class="warning">O botão é liberado após ${view.minWaitSeconds} segundo(s).</p>` : ''}
<p class="warning">O ${APP_NAME} não verifica nem garante o conteúdo do destino, que pode mudar a qualquer momento. Desconfie de pedidos de senha, pagamento ou download.</p>
<p class="meta">${view.expiresAt !== null ? html`Este link expira em ${formatDate(view.expiresAt)}. · ` : ''}<a href="/denunciar?link=${view.slug}">Denunciar este link</a></p>
</main>
${renderAdArea(view.ads)}`;

  return layout({
    nonce,
    title: `Você está saindo do ${APP_NAME} — destino: ${destinationLabel}`,
    body,
    bodyAttributes: html` data-wait="${view.minWaitSeconds}" data-ad-timeout="8000"`,
    script: true,
  });
}

export type StatusPageKind = 'not_found' | 'expired' | 'deleted' | 'blocked' | 'rate_limited' | 'unavailable' | 'bad_request' | 'method_not_allowed';

const STATUS_PAGES: Record<StatusPageKind, { status: number; title: string; message: string; report: boolean }> = {
  not_found: { status: 404, title: 'Link não encontrado', message: 'Confira se o endereço foi copiado corretamente.', report: false },
  expired: { status: 410, title: 'Este link expirou', message: 'O prazo de validade escolhido por quem criou o link terminou.', report: false },
  deleted: { status: 410, title: 'Este link foi removido', message: 'O link não está mais disponível. Códigos removidos não são reutilizados.', report: false },
  blocked: {
    status: 403,
    title: 'Este link foi bloqueado',
    message: 'O acesso foi bloqueado por violação dos termos de uso, após denúncia ou por bloqueio do domínio de destino.',
    report: false,
  },
  rate_limited: { status: 429, title: 'Muitas tentativas', message: 'Aguarde alguns instantes e tente novamente.', report: false },
  unavailable: {
    status: 503,
    title: 'Não foi possível verificar este link agora',
    message: 'Por segurança, não redirecionamos sem confirmar que o link continua liberado. Tente novamente em instantes.',
    report: false,
  },
  bad_request: { status: 400, title: 'Requisição inválida', message: 'Volte à página do link e tente novamente.', report: false },
  method_not_allowed: { status: 405, title: 'Método não permitido', message: 'Abra o link curto normalmente no navegador.', report: false },
};

export function statusPage(kind: StatusPageKind, nonce: string): { status: number; html: string } {
  const page = STATUS_PAGES[kind];
  const body = html`<main id="conteudo" class="card">
<p class="status-code">Erro ${page.status}</p>
<h1>${page.title}</h1>
<p>${page.message}</p>
<p><a href="/">Ir para a página inicial do ${APP_NAME}</a></p>
</main>`;
  return { status: page.status, html: layout({ nonce, title: `${page.title} — ${APP_NAME}`, body }) };
}
