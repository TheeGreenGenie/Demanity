import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, RP, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.close();
});

const preflight = (origin: string) =>
  h.app.inject({
    method: 'OPTIONS',
    url: '/v1/accounts',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,authorization',
    },
  });

describe('CORS', () => {
  it('allows the app origin with only the needed headers', async () => {
    const res = await preflight(RP.origins[0]!);
    expect(res.headers['access-control-allow-origin']).toBe(RP.origins[0]);
    expect(String(res.headers['access-control-allow-headers'])).toMatch(/authorization/);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('allows PATCH (used to update leader request status)', async () => {
    const res = await preflight(RP.origins[0]!);
    expect(String(res.headers['access-control-allow-methods'])).toMatch(/PATCH/);
  });

  it('does not allow other origins', async () => {
    const res = await preflight('https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
