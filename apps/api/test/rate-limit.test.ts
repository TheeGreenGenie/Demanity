import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeIp, rateLimitKey } from '../src/rate-limit.js';

describe('normalizeIp', () => {
  it('keeps IPv4 and unwraps IPv4-mapped IPv6', () => {
    expect(normalizeIp('203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('truncates IPv6 to its /64 network', () => {
    expect(normalizeIp('2001:db8:abcd:12:1:2:3:4')).toBe('2001:0db8:abcd:0012::/64');
    expect(normalizeIp('2001:db8:abcd:12::99')).toBe('2001:0db8:abcd:0012::/64');
    expect(normalizeIp('2001:db8::1')).toBe('2001:0db8:0000:0000::/64');
    expect(normalizeIp('::1')).toBe('0000:0000:0000:0000::/64');
  });

  it('groups addresses in the same /64 together', () => {
    expect(normalizeIp('2001:db8:1:2:aaaa::1')).toBe(normalizeIp('2001:db8:1:2:bbbb::2'));
    expect(normalizeIp('2001:db8:1:2::1')).not.toBe(normalizeIp('2001:db8:1:3::1'));
  });

  it('handles junk safely', () => {
    expect(normalizeIp('not-an-ip')).toBe('unknown');
  });
});

describe('rateLimitKey', () => {
  const secret = randomBytes(32);
  const day1 = new Date('2026-11-09T10:00:00Z');

  it('never contains the IP and is stable within a day', () => {
    const k = rateLimitKey(secret, '203.0.113.7', day1);
    expect(k).not.toContain('203');
    expect(rateLimitKey(secret, '203.0.113.7', new Date('2026-11-09T23:59:59Z'))).toBe(k);
  });

  it('cannot be linked across days', () => {
    expect(rateLimitKey(secret, '203.0.113.7', day1)).not.toBe(
      rateLimitKey(secret, '203.0.113.7', new Date('2026-11-10T00:00:00Z')),
    );
  });

  it('depends on the secret', () => {
    expect(rateLimitKey(secret, '203.0.113.7', day1)).not.toBe(
      rateLimitKey(randomBytes(32), '203.0.113.7', day1),
    );
  });
});
