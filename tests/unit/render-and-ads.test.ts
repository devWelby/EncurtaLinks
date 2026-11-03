import { describe, expect, it } from 'vitest';
import { analyzeSnippet, cspForSlots, loadAdsConfig } from '../../src/server/ads/adsterra.ts';
import { escapeHtml, html, trustedHtml } from '../../src/server/render/html.ts';
import { interstitialCsp, renderInterstitial, statusPage, type InterstitialView } from '../../src/server/render/pages.ts';

describe('escape de HTML', () => {
  it('escapa os caracteres perigosos', () => {
    expect(escapeHtml(`<script>"x"&'y'\`</script>`)).toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&#96;&lt;/script&gt;');
  });

  it('o template escapa valores interpolados, mas não SafeHtml', () => {
    const value = '<img src=x onerror=alert(1)>';
    expect(html`<p>${value}</p>`.value).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
    expect(html`<p>${trustedHtml('<b>ok</b>')}</p>`.value).toBe('<p><b>ok</b></p>');
    expect(html`${null}${undefined}${false}`.value).toBe('');
  });

  it('recusa objetos arbitrários (evita "[object Object]")', () => {
    expect(() => html`${{ a: 1 }}`).toThrow(TypeError);
  });
});

const baseView: InterstitialView = {
  slug: 'abcdefghij',
  ticket: 'T'.repeat(43),
  destinationUrl: 'https://example.com/"><script>alert(1)</script>',
  destinationHost: 'example.com',
  unicodeHost: null,
  expiresAt: null,
  notice: null,
  minWaitSeconds: 0,
  ads: { kind: 'none' },
};

describe('página intermediária', () => {
  it('escapa a URL de destino e não contém scripts sem nonce', () => {
    const page = renderInterstitial(baseView, 'NONCE123');
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    const scripts = [...page.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1] ?? '');
    expect(scripts.length).toBeGreaterThan(0);
    for (const attributes of scripts) expect(attributes).toContain('nonce="NONCE123"');
  });

  it('mostra o domínio de destino e um único formulário de continuação via POST', () => {
    const page = renderInterstitial(baseView, 'N');
    expect(page).toContain('data-destination-host>example.com<');
    expect(page.match(/<form /g)).toHaveLength(1);
    expect(page).toContain('method="post" action="/s/abcdefghij/continue"');
    expect(page).toContain('Continuar para example.com');
    expect(page).not.toMatch(/[?&]url=/);
  });

  it('identifica a publicidade como "Publicidade"', () => {
    const page = renderInterstitial({ ...baseView, ads: { kind: 'placeholder' } }, 'N');
    expect(page).toContain('Publicidade');
  });

  it('CSP sem anúncios é restrita ao nonce', () => {
    const csp = interstitialCsp('abc', null);
    expect(csp).toContain("script-src 'nonce-abc'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('páginas de estado têm o código HTTP correto', () => {
    expect(statusPage('not_found', 'n').status).toBe(404);
    expect(statusPage('expired', 'n').status).toBe(410);
    expect(statusPage('deleted', 'n').status).toBe(410);
    expect(statusPage('blocked', 'n').status).toBe(403);
    expect(statusPage('rate_limited', 'n').status).toBe(429);
    expect(statusPage('unavailable', 'n').status).toBe(503);
  });
});

const BANNER = `<script type="text/javascript">
  atOptions = { 'key' : 'exemplo', 'format' : 'iframe', 'height' : 250, 'width' : 300, 'params' : {} };
</script>
<script type="text/javascript" src="//ads.example-network.com/exemplo/invoke.js"></script>`;

describe('tags do Adsterra', () => {
  it('calcula o hash CSP do script inline e a origem do script externo', () => {
    const analysis = analyzeSnippet(BANNER, { allowHttp: false });
    expect(analysis.errors).toEqual([]);
    expect(analysis.inlineScriptHashes).toHaveLength(1);
    expect(analysis.inlineScriptHashes[0]).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
    expect(analysis.scriptOrigins).toEqual(['https://ads.example-network.com']);
  });

  it.each([
    '<iframe src="https://x.example"></iframe>',
    '<form action="https://x.example"></form>',
    '<meta http-equiv="refresh" content="0;url=https://x.example">',
    '<base href="https://x.example/">',
  ])('recusa elementos não permitidos: %s', (snippet) => {
    expect(analyzeSnippet(snippet, { allowHttp: false }).errors.length).toBeGreaterThan(0);
  });

  it('exige https em produção', () => {
    expect(analyzeSnippet('<script src="http://ads.example/x.js"></script>', { allowHttp: false }).errors).not.toEqual([]);
  });

  it('em testes/CI só aceita anúncios simulados locais', () => {
    const config = loadAdsConfig(
      { ADS_ENABLED: 'true', ADSTERRA_SLOT_PRIMARY_HTML: BANNER },
      { isProduction: false, isTestOrCi: true, testOrigins: ['http://localhost:8888'] },
    );
    expect(config.slots).toEqual([]);
    expect(config.errors.join(' ')).toMatch(/simulados locais/);
  });

  it('fica desligado por padrão', () => {
    const config = loadAdsConfig({}, { isProduction: true, isTestOrCi: false, testOrigins: [] });
    expect(config.envEnabled).toBe(false);
    expect(config.slots).toEqual([]);
    expect(config.devPlaceholder).toBe(false);
    expect(config.requireConsent).toBe(true);
  });

  it('CSP com anúncios libera somente o necessário', () => {
    const config = loadAdsConfig(
      { ADS_ENABLED: 'true', ADSTERRA_SLOT_PRIMARY_HTML: BANNER },
      { isProduction: true, isTestOrCi: false, testOrigins: [] },
    );
    expect(config.errors).toEqual([]);
    const sources = cspForSlots(config, config.slots);
    const csp = interstitialCsp('n', sources);
    expect(csp).toContain('https://ads.example-network.com');
    expect(csp).toContain("'sha256-");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
