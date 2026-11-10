import { createHmac } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

/**
 * Privacy-preserving rate-limit keys (docs/PRIVACY.md: IPs are kept only
 * hashed and for 24 hours or less).
 *
 * key = HMAC(dailySecret, normalizedIp), where dailySecret = HMAC(secret, UTC date).
 * The raw IP is never stored. Because the daily secret rotates, keys from
 * different days cannot be linked, and each key also expires from Redis when
 * its rate-limit window ends.
 */

/** Expands an IPv6 address to 8 full hextets. Assumes `isIPv6(ip)`. */
function expandIPv6(ip: string): string[] {
  const [head = '', tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const missing = 8 - h.length - t.length;
  const groups = tail === undefined ? h : [...h, ...Array<string>(missing).fill('0'), ...t];
  return groups.map((g) => g.padStart(4, '0').toLowerCase());
}

/** IPv4-mapped IPv6 becomes IPv4; other IPv6 is truncated to its /64 network. */
export function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped && isIPv4(mapped[1]!)) return mapped[1]!;
  if (isIPv4(ip)) return ip;
  if (isIPv6(ip)) return `${expandIPv6(ip).slice(0, 4).join(':')}::/64`;
  return 'unknown';
}

export function rateLimitKey(secret: Buffer, ip: string, now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const daily = createHmac('sha256', secret).update(`demanity:ratelimit:${day}`).digest();
  return createHmac('sha256', daily).update(normalizeIp(ip)).digest('base64url');
}

/** Per-route limits for costly or abuse-prone endpoints. */
export type RouteLimit = { max: number; timeWindow: string };
export type RouteLimits = Record<
  'signup' | 'verification' | 'codeSend' | 'codeCheck' | 'signIn',
  RouteLimit
>;

export const ROUTE_LIMITS: RouteLimits = {
  signup: { max: 5, timeWindow: '1 hour' },
  verification: { max: 5, timeWindow: '1 hour' }, // each attempt may cost a provider fee
  codeSend: { max: 5, timeWindow: '15 minutes' },
  codeCheck: { max: 10, timeWindow: '15 minutes' },
  signIn: { max: 30, timeWindow: '1 minute' },
};
