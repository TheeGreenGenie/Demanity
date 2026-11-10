import { describe, expect, it } from 'vitest';
import { TwilioVerifyProvider } from '../src/providers/two-factor.js';

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift()!;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const opts = { accountSid: 'AC123', authToken: 'tok', serviceSid: 'VA456' };

describe('TwilioVerifyProvider', () => {
  it('starts a verification with the documented endpoint, auth and form body', async () => {
    const f = fakeFetch([{ status: 201, body: { status: 'pending' } }]);
    await new TwilioVerifyProvider(opts, f.impl).start('+14155552671', 'sms');

    const [call] = f.calls;
    expect(call!.url).toBe('https://verify.twilio.com/v2/Services/VA456/Verifications');
    expect(call!.init.method).toBe('POST');
    const headers = call!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from('AC123:tok').toString('base64')}`);
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(call!.init.body as string).get('To')).toBe('+14155552671');
    expect(new URLSearchParams(call!.init.body as string).get('Channel')).toBe('sms');
  });

  it('treats only status "approved" as a passed check', async () => {
    const f = fakeFetch([
      { status: 200, body: { status: 'approved' } },
      { status: 200, body: { status: 'pending' } },
    ]);
    const p = new TwilioVerifyProvider(opts, f.impl);
    expect(await p.check('+14155552671', '123456')).toBe(true);
    expect(await p.check('+14155552671', '000000')).toBe(false);
    expect(f.calls[0]!.url).toBe('https://verify.twilio.com/v2/Services/VA456/VerificationCheck');
  });

  it('treats 404 (expired or unknown) as a failed check, and other errors as exceptions', async () => {
    const f = fakeFetch([{ status: 404 }, { status: 500 }]);
    const p = new TwilioVerifyProvider(opts, f.impl);
    expect(await p.check('+14155552671', '123456')).toBe(false);
    await expect(p.check('+14155552671', '123456')).rejects.toThrow(/HTTP 500/);
  });

  it('rejects a service SID that is not a Verify service', () => {
    expect(() => new TwilioVerifyProvider({ ...opts, serviceSid: 'MG1' })).toThrow(/VA/);
  });
});
