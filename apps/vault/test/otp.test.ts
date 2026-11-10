import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, type Pool } from '@demanity/db';
import { createTempDatabase } from '@demanity/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryEmailSender, ResendEmailSender } from '../src/providers/email.js';
import { EmailOtpProvider, OTP_POLICY, OtpRateLimitedError } from '../src/providers/otp.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

let pool: Pool;
let drop: () => Promise<void>;
const key = randomBytes(32);

beforeAll(async () => {
  const db = await createTempDatabase();
  drop = db.drop;
  pool = createPool(db.url);
  await migrate(pool, MIGRATIONS);
});

afterAll(async () => {
  await pool?.end();
  await drop?.();
});

let n = 0;
const address = () => `otp${++n}@example.com`;

function provider(now: () => Date = () => new Date()) {
  const mail = new InMemoryEmailSender();
  return { otp: new EmailOtpProvider(pool, key, mail, now), mail };
}

describe('EmailOtpProvider (free email 2FA)', () => {
  it('sends a 6-digit code that verifies once', async () => {
    const { otp, mail } = provider();
    const to = address();
    await otp.start(to, 'email');
    const code = mail.lastCode(to)!;
    expect(code).toMatch(/^\d{6}$/);
    expect(mail.outbox[0]!.subject).toBe('Your Demanity verification code');

    expect(await otp.check(to, code)).toBe(true);
    expect(await otp.check(to, code)).toBe(false); // single use
  });

  it('stores neither the code nor the address', async () => {
    const { otp, mail } = provider();
    const to = address();
    await otp.start(to, 'email');
    const code = mail.lastCode(to)!;
    const dump = JSON.stringify((await pool.query('SELECT * FROM otp_challenges')).rows);
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(to);
  });

  it('rejects wrong, malformed and expired codes', async () => {
    let now = new Date('2026-11-09T12:00:00Z');
    const { otp, mail } = provider(() => now);
    const to = address();
    await otp.start(to, 'email');
    const code = mail.lastCode(to)!;
    const wrong = code === '000000' ? '000001' : '000000';
    expect(await otp.check(to, wrong)).toBe(false);
    expect(await otp.check(to, 'abc123')).toBe(false);
    now = new Date(now.getTime() + OTP_POLICY.ttlSeconds * 1000 + 1);
    expect(await otp.check(to, code)).toBe(false); // expired
  });

  it('locks a code after 5 wrong guesses, even if the right code follows', async () => {
    const { otp, mail } = provider();
    const to = address();
    await otp.start(to, 'email');
    const code = mail.lastCode(to)!;
    const wrong = code === '999999' ? '999998' : '999999';
    for (let i = 0; i < OTP_POLICY.maxAttempts; i++) expect(await otp.check(to, wrong)).toBe(false);
    expect(await otp.check(to, code)).toBe(false);
  });

  it('caps sends at 5 per hour per address, then resets after the window', async () => {
    let now = new Date('2026-11-09T12:00:00Z');
    const { otp } = provider(() => now);
    const to = address();
    for (let i = 0; i < OTP_POLICY.maxSendsPerWindow; i++) await otp.start(to, 'email');
    await expect(otp.start(to, 'email')).rejects.toBeInstanceOf(OtpRateLimitedError);

    now = new Date(now.getTime() + OTP_POLICY.windowSeconds * 1000 + 1);
    await expect(otp.start(to, 'email')).resolves.toBeUndefined();
  });

  it('invalidates the previous code when a new one is sent', async () => {
    const { otp, mail } = provider();
    const to = address();
    await otp.start(to, 'email');
    const first = mail.lastCode(to)!;
    await otp.start(to, 'email');
    const second = mail.lastCode(to)!;
    if (first !== second) expect(await otp.check(to, first)).toBe(false);
    expect(await otp.check(to, second)).toBe(true);
  });

  it('generates varied codes (not a constant)', async () => {
    const { otp, mail } = provider();
    const codes = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const to = address();
      await otp.start(to, 'email');
      codes.add(mail.lastCode(to)!);
    }
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('ResendEmailSender', () => {
  it('posts the documented request', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'abc' }), { status: 200 });
    }) as unknown as typeof fetch;
    await new ResendEmailSender('re_123', 'Demanity <codes@example.org>', fetchImpl).send({
      to: 'a@example.com',
      subject: 's',
      text: 't',
    });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer re_123');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      from: 'Demanity <codes@example.org>',
      to: ['a@example.com'],
      subject: 's',
      text: 't',
    });
  });

  it('throws on HTTP errors and rejects malformed keys', async () => {
    const fail = (async () => new Response('{}', { status: 422 })) as unknown as typeof fetch;
    await expect(
      new ResendEmailSender('re_1', 'x@example.org', fail).send({
        to: 'a@b.co',
        subject: 's',
        text: 't',
      }),
    ).rejects.toThrow(/422/);
    expect(() => new ResendEmailSender('not-a-resend-key', 'x@example.org')).toThrow(/re_/);
  });
});
