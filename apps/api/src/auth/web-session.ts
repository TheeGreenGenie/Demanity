import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_TTL_SECONDS } from './sessions.js';
import type { SessionScope } from './sessions.js';

/**
 * Web sessions in HttpOnly cookies (R3). Native apps keep bearer tokens in
 * the OS keychain; the web app can't, so its session token never reaches
 * JavaScript:
 *
 * - The web client marks every request with `x-demanity-client: web`. Only
 *   such requests get the token as a cookie instead of in the body, and only
 *   such requests are authenticated by the cookie.
 * - That custom header can't be sent cross-origin without a CORS preflight,
 *   and CORS allows only the app's own origins, so other sites can't use the
 *   cookie (CSRF). The cookie is also `SameSite=Strict`.
 * - Production: `__Host-` prefix, `Secure`, `Path=/`, no `Domain`.
 */
export const WEB_CLIENT_HEADER = 'x-demanity-client';
/** What the web app receives in place of a token. It is not a secret. */
export const COOKIE_SESSION = 'cookie';

const production = () => process.env.NODE_ENV === 'production';
export const cookieName = () => (production() ? '__Host-dm_session' : 'dm_session');

export const isWebClient = (req: FastifyRequest) => req.headers[WEB_CLIENT_HEADER] === 'web';

export function cookieToken(req: FastifyRequest): string | null {
  if (!isWebClient(req)) return null;
  const name = cookieName();
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      const value = v.join('=');
      return /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : null;
    }
  }
  return null;
}

function setCookie(reply: FastifyReply, value: string, maxAge: number) {
  const attrs = [
    `${cookieName()}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
    ...(production() ? ['Secure'] : []),
  ];
  reply.header('set-cookie', attrs.join('; '));
}

/** Returns what to put in the response body: the token, or the cookie marker for web. */
export function deliverToken(
  req: FastifyRequest,
  reply: FastifyReply,
  token: string,
  scope: SessionScope,
): string {
  if (!isWebClient(req)) return token;
  setCookie(reply, token, SESSION_TTL_SECONDS[scope]);
  return COOKIE_SESSION;
}

export function clearSessionCookie(req: FastifyRequest, reply: FastifyReply) {
  if (isWebClient(req)) setCookie(reply, '', 0);
}
