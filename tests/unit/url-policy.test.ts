import { describe, expect, it } from 'vitest';
import { hostSuffixes, isOwnHost, validateDestinationUrl } from '../../src/server/security/url-policy.ts';

const OWN = ['encurtalinks.netlify.app', 'encurtalinks-admin.netlify.app', 'localhost'];
const check = (url: unknown) => validateDestinationUrl(url, { ownHosts: OWN });
const codeOf = (url: unknown) => {
  const result = check(url);
  return result.ok ? 'ok' : result.code;
};

describe('validateDestinationUrl — URLs válidas', () => {
  it.each([
    'https://example.com',
    'http://example.com/caminho?q=1#topo',
    'https://sub.dominio.com.br/a/b',
    'HTTPS://EXAMPLE.COM/Path',
    'https://example.com:443/padrao',
    'http://example.com:80/padrao',
    'https://xn--bcher-kva.de/', // bücher.de — um único alfabeto
  ])('aceita %s', (url) => {
    expect(codeOf(url)).toBe('ok');
  });

  it('normaliza o host em minúsculas e remove porta padrão', () => {
    const result = check('HTTPS://Example.COM:443/X');
    expect(result).toMatchObject({ ok: true, host: 'example.com', url: 'https://example.com/X' });
  });

  it('identifica IDN e devolve a forma Unicode', () => {
    const result = check('https://xn--bcher-kva.de/');
    expect(result).toMatchObject({ ok: true, isIdn: true, unicodeHost: 'bücher.de' });
  });
});

describe('validateDestinationUrl — protocolos e formato', () => {
  it.each([
    ['javascript:alert(1)', 'unsupported_protocol'],
    ['JaVaScRiPt:alert(document.cookie)', 'unsupported_protocol'],
    ['data:text/html,<script>alert(1)</script>', 'unsupported_protocol'],
    ['file:///etc/passwd', 'unsupported_protocol'],
    ['ftp://example.com/arquivo', 'unsupported_protocol'],
    ['vbscript:msgbox(1)', 'unsupported_protocol'],
    ['example.com', 'missing_scheme'],
    ['//example.com', 'missing_scheme'],
    ['', 'empty'],
    ['   ', 'empty'],
    [42, 'invalid_type'],
    [null, 'invalid_type'],
    ['https://', 'invalid_url'],
    ['https://exa mple.com', 'invalid_characters'],
  ])('%s → %s', (url, code) => {
    expect(codeOf(url)).toBe(code);
  });

  it('recusa URLs longas demais', () => {
    expect(codeOf(`https://example.com/${'a'.repeat(2100)}`)).toBe('too_long');
  });

  it('recusa credenciais embutidas', () => {
    expect(codeOf('https://user:senha@example.com/')).toBe('credentials_not_allowed');
    expect(codeOf('https://user@example.com/')).toBe('credentials_not_allowed');
  });

  it('recusa portas não padrão', () => {
    expect(codeOf('https://example.com:8443/')).toBe('port_not_allowed');
    expect(codeOf('http://example.com:22/')).toBe('port_not_allowed');
  });
});

describe('validateDestinationUrl — injeção de cabeçalhos e caracteres de controle', () => {
  it.each([
    'https://example.com/\r\nSet-Cookie: a=b',
    'https://example.com/\nLocation: https://evil.example',
    'https://example.com/%0d%0a\u0000',
    'https://example.com/‮gnp.exe', // bidi override
    'https://exa​mple.com/', // largura zero
    'https://example.com/\u0007',
    'https://example.com\\@evil.example/',
  ])('recusa %j', (url) => {
    expect(codeOf(url)).toBe('invalid_characters');
  });

  it('mantém sequências percent-encoded (não viram quebra de linha no Location)', () => {
    const result = check('https://example.com/%0d%0aSet-Cookie:x');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).not.toMatch(/[\r\n]/);
  });
});

describe('validateDestinationUrl — endereços locais, privados e reservados', () => {
  it.each([
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/', // decimal
    'http://0x7f000001/', // hexadecimal
    'http://0177.0.0.1/', // octal
    'http://0x7f.0.0.1/',
    'http://10.0.0.5/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/', // metadados de nuvem
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    'http://198.18.0.1/',
    'http://[::1]/',
    'http://[::]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[64:ff9b::a00:1]/', // NAT64 → 10.0.0.1
    'http://[2002:7f00:1::]/', // 6to4 → 127.0.0.1
    'http://[2001:db8::1]/', // documentação
    'http://[ff02::1]/',
    'http://localtest.me/',
    'http://127.0.0.1.nip.io/',
    'http://10.0.0.1.sslip.io/',
  ])('recusa %s como privado', (url) => {
    expect(codeOf(url)).toBe('private_address');
  });

  it.each(['http://8.8.8.8/', 'http://1.1.1.1/', 'http://[2606:4700:4700::1111]/'])('recusa IP público literal %s', (url) => {
    expect(codeOf(url)).toBe('ip_not_allowed');
  });

  it.each([
    'http://localhost/',
    'http://LOCALHOST./',
    'http://app.localhost/',
    'http://servidor.local/',
    'http://nas.lan/',
    'http://intranet.internal/',
    'http://router.home.arpa/',
    'http://exemplo.test/',
    'http://site.example/',
    'http://site.invalid/',
    'http://abc.onion/',
    'http://1.0.0.127.in-addr.arpa/',
  ])('recusa domínio reservado %s', (url) => {
    expect(['reserved_host', 'invalid_host', 'self_reference']).toContain(codeOf(url));
  });

  it.each(['http://intranet/', 'http://example.com./', 'http://-a.com/', 'http://a_b.com/'])('recusa host inválido %s', (url) => {
    expect(codeOf(url)).toBe('invalid_host');
  });

  it('recusa TLD numérico (o parser trata como IPv4 inválido)', () => {
    expect(['invalid_url', 'invalid_host']).toContain(codeOf('http://example.123/'));
  });

  it('aceita rótulo cirílico com letras sem sósia latino', () => {
    expect(codeOf('https://xn--n1aac5a.com/')).toBe('ok'); // очпо.com
  });
});

describe('validateDestinationUrl — laços e homógrafos', () => {
  it.each([
    'https://encurtalinks.netlify.app/s/abc',
    'https://ENCURTALINKS.netlify.app/',
    'https://encurtalinks-admin.netlify.app/',
    'https://6543abcd--encurtalinks.netlify.app/s/x', // URL única de deploy
    'https://deploy-preview-3--encurtalinks.netlify.app/',
  ])('recusa autorreferência %s', (url) => {
    expect(codeOf(url)).toBe('self_reference');
  });

  it('não confunde outro site do netlify.app com o próprio', () => {
    expect(codeOf('https://outro-site.netlify.app/')).toBe('ok');
    expect(codeOf('https://notencurtalinks.netlify.app/')).toBe('ok');
  });

  it('recusa domínio com mistura de alfabetos (latim + cirílico)', () => {
    // "аpple.com" com "а" cirílico
    expect(codeOf('https://xn--pple-43d.com/')).toBe('confusable_host');
  });

  it('recusa rótulo cirílico composto só de sósias latinos sob TLD ASCII', () => {
    // "орео.com" todo em cirílico parece "opeo"
    expect(codeOf('https://xn--e1arbg.com/')).toBe('confusable_host');
  });

  it('aceita domínio inteiramente em cirílico com TLD cirílico', () => {
    expect(codeOf('https://xn--d1acufc.xn--p1ai/')).toBe('ok'); // домен.рф
  });
});

describe('utilitários de host', () => {
  it('hostSuffixes lista sufixos até o domínio de 2 níveis', () => {
    expect(hostSuffixes('a.b.example.com')).toEqual(['a.b.example.com', 'b.example.com', 'example.com']);
  });

  it('isOwnHost cobre subdomínios', () => {
    expect(isOwnHost('x.localhost', ['localhost'])).toBe(true);
    expect(isOwnHost('example.com', ['localhost'])).toBe(false);
  });
});
