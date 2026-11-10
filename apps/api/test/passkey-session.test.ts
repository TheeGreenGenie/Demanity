import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, identity, RP, type Harness } from './harness.js';
import { SoftAuthenticator } from './soft-authenticator.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.close();
});

describe('passkey registration during sign-up', () => {
  it('returns a full session and ends the sign-up session (one device prompt)', async () => {
    const { app, mail } = h;
    const onboarding = (
      await app.inject({ method: 'POST', url: '/v1/accounts', payload: { username: 'one_prompt' } })
    ).json().token as string;
    const auth = bearer(onboarding);
    await app.inject({
      method: 'POST',
      url: '/v1/me/verification',
      headers: auth,
      payload: identity(),
    });
    await app.inject({
      method: 'PUT',
      url: '/v1/me/contacts/email',
      headers: auth,
      payload: { value: 'one@example.com' },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/me/contacts/email/confirm',
      headers: auth,
      payload: { code: mail.lastCode('one@example.com')! },
    });

    const device = new SoftAuthenticator(RP.id, RP.origins[0]!);
    const options = (
      await app.inject({ method: 'POST', url: '/v1/me/passkeys/options', headers: auth })
    ).json();
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/me/passkeys',
      headers: auth,
      payload: { response: device.register(options) },
    });
    expect(reg.statusCode).toBe(201);
    const full = reg.json().token as string;
    expect(full).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(full) });
    expect(me.json()).toEqual({ username: 'one_prompt', status: 'active', scope: 'full' });
    // The limited sign-up session is gone.
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: auth })).statusCode).toBe(
      401,
    );
  });

  it('adds extra passkeys from a full session without issuing a new token', async () => {
    const { app } = h;
    // Reuse the account above via a passkey sign-in, then register a second device.
    const { rows } = await h.apiPool.query("SELECT id FROM accounts WHERE username = 'one_prompt'");
    expect(rows).toHaveLength(1);
    const { createSession } = await import('../src/auth/sessions.js');
    const full = await createSession(h.apiPool, rows[0].id, 'full');
    const second = new SoftAuthenticator(RP.id, RP.origins[0]!);
    const options = (
      await app.inject({ method: 'POST', url: '/v1/me/passkeys/options', headers: bearer(full) })
    ).json();
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/me/passkeys',
      headers: bearer(full),
      payload: { response: second.register(options) },
    });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().token).toBeUndefined();
    expect(
      (await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(full) })).statusCode,
    ).toBe(200);
  });
});
