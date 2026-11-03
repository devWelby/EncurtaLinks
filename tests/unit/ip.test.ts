import { describe, expect, it } from 'vitest';
import { classifyIp, normalizeClientIp, parseIp, parseIPv4, parseIPv6 } from '../../src/server/security/ip.ts';

describe('parseIPv4', () => {
  it('aceita apenas a forma canônica', () => {
    expect(parseIPv4('192.168.0.1')).toEqual([192, 168, 0, 1]);
    expect(parseIPv4('256.0.0.1')).toBeNull();
    expect(parseIPv4('01.2.3.4')).toBeNull();
    expect(parseIPv4('1.2.3')).toBeNull();
    expect(parseIPv4('1.2.3.4.5')).toBeNull();
  });
});

describe('parseIPv6', () => {
  it('expande "::" e aceita colchetes', () => {
    expect(parseIPv6('[::1]')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('2001:db8::')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
  });

  it('aceita IPv4 embutido', () => {
    expect(parseIPv6('::ffff:10.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0a00, 0x0001]);
    expect(parseIPv6('64:ff9b::192.168.0.1')).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0xc0a8, 0x0001]);
  });

  it('recusa formas inválidas e zonas', () => {
    expect(parseIPv6('fe80::1%eth0')).toBeNull();
    expect(parseIPv6('1::2::3')).toBeNull();
    expect(parseIPv6('12345::')).toBeNull();
    expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull();
  });
});

describe('classifyIp', () => {
  const kind = (value: string) => {
    const parsed = parseIp(value);
    if (parsed === null) throw new Error(`não analisou ${value}`);
    return classifyIp(parsed);
  };

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450:4001::1'])('%s é público', (ip) => {
    expect(kind(ip)).toBe('public');
  });

  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.100.100.100',
    '127.0.0.1',
    '169.254.169.254',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.10.10',
    '198.19.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.251',
    '240.0.0.1',
    '::',
    '::1',
    '::ffff:192.168.0.1',
    '::127.0.0.1',
    '64:ff9b::7f00:1',
    '2002:c0a8:0101::1',
    'fc00::1',
    'fe80::1',
    'ff00::1',
    '2001:db8::1',
    '2001::1',
    '3fff::1',
    '100::1',
  ])('%s não é público', (ip) => {
    expect(kind(ip)).toBe('non_public');
  });

  it('NAT64 e 6to4 de IPv4 público são públicos', () => {
    expect(kind('64:ff9b::808:808')).toBe('public');
    expect(kind('2002:0808:0808::1')).toBe('public');
  });
});

describe('normalizeClientIp', () => {
  it('IPv4 e IPv4 mapeado viram a mesma chave', () => {
    expect(normalizeClientIp('203.0.113.5')).toBe('v4:203.0.113.5');
    expect(normalizeClientIp('::ffff:203.0.113.5')).toBe('v4:203.0.113.5');
  });

  it('IPv6 é agregado por /64', () => {
    expect(normalizeClientIp('2001:db8:1:2:aaaa::1')).toBe(normalizeClientIp('2001:db8:1:2:bbbb::9'));
    expect(normalizeClientIp('2001:db8:1:2::1')).not.toBe(normalizeClientIp('2001:db8:1:3::1'));
  });

  it('valores inválidos retornam null', () => {
    expect(normalizeClientIp('não é ip')).toBeNull();
    expect(normalizeClientIp('')).toBeNull();
  });
});
