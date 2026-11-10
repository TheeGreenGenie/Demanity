import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, onboard, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.close();
});

const WEB = { 'x-demanity-client': 'web' };

describe('web sessions in HttpOnly cookies', () => {
  it('gives web clients a cookie instead of a token, and accepts it only with the web header', async () => {
    const { device } = await onboard(h, 'webby');
    const { challengeId, options } = (
      await h.app.inject({ method: 'POST', url: '/v1/auth/passkey/options' })
    ).json();
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/passkey',
      headers: WEB,
      payload: { challengeId, response: device.authenticate(options) },
    });
    expect(res.json()).toEqual({ token: 'cookie' });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^dm_session=[A-Za-z0-9_-]{40,}; /);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    const cookie = setCookie.split(';')[0]!;

    // With the web header, the cookie authenticates.
    const me = await h.app.inject({ method: 'GET', url: '/v1/me', headers: { ...WEB, cookie } });
    expect(me.json().username).toBe('webby');
    // Without it (e.g. a cross-site form post), the cookie is ignored.
    expect(
      (await h.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).statusCode,
    ).toBe(401);
    // The placeholder is never a credential.
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: '/v1/me',
          headers: { ...WEB, authorization: 'Bearer cookie' },
        })
      ).statusCode,
    ).toBe(401);

    // Sign-out ends the session and clears the cookie.
    const out = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { ...WEB, cookie },
    });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/^dm_session=; .*Max-Age=0/);
    expect(
      (await h.app.inject({ method: 'GET', url: '/v1/me', headers: { ...WEB, cookie } }))
        .statusCode,
    ).toBe(401);
  });

  it('allows credentialed CORS only for the app origin and with the web header', async () => {
    const pre = await h.app.inject({
      method: 'OPTIONS',
      url: '/v1/me',
      headers: {
        origin: 'http://localhost:8081',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-demanity-client,content-type',
      },
    });
    expect(pre.headers['access-control-allow-credentials']).toBe('true');
    expect(String(pre.headers['access-control-allow-headers'])).toContain('x-demanity-client');
    const evil = await h.app.inject({
      method: 'OPTIONS',
      url: '/v1/me',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-demanity-client',
      },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});
