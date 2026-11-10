import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, type Pool } from '@demanity/db';
import { createTempDatabase } from '@demanity/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryEmailSender } from '../src/providers/email.js';
import {
  CappedEmailSender,
  CappedTwoFactor,
  OutboundCap,
  outboundLimits,
} from '../src/providers/outbound-cap.js';
import { EmailOtpProvider, OtpRateLimitedError } from '../src/providers/otp.js';
import { InMemoryTwoFactorProvider } from '../src/providers/two-factor.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
let pool: Pool;
let drop: () => Promise<void>;

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

describe('service-wide outbound caps', () => {
  it('stops sending once the hourly cap is reached, across different addresses', async () => {
    const mail = new InMemoryEmailSender();
    const capped = new CappedEmailSender(
      mail,
      new OutboundCap(pool, 'email', { perHour: 3, perDay: 100 }),
    );
    const otp = new EmailOtpProvider(pool, randomBytes(32), capped);
    for (let i = 0; i < 3; i++) await otp.start(`person${i}@example.com`, 'email');
    await expect(otp.start('person9@example.com', 'email')).rejects.toBeInstanceOf(
      OtpRateLimitedError,
    );
    expect(mail.outbox).toHaveLength(3); // the 4th was never sent
  });

  it('applies the daily cap too, and counts nothing when refused', async () => {
    const cap = new OutboundCap(pool, 'sms', { perHour: 100, perDay: 2 });
    const inner = new InMemoryTwoFactorProvider();
    const sms = new CappedTwoFactor(inner, cap);
    await sms.start('+15550000001', 'sms');
    await sms.start('+15550000002', 'sms');
    await expect(sms.start('+15550000003', 'sms')).rejects.toBeInstanceOf(OtpRateLimitedError);
    const { rows } = await pool.query(
      "SELECT window_kind, sent FROM outbound_usage WHERE provider = 'sms' ORDER BY window_kind",
    );
    expect(rows).toEqual([
      { window_kind: 'day', sent: 2 },
      { window_kind: 'hour', sent: 2 },
    ]);
  });

  it('defaults stay inside Resend’s free 100/day', () => {
    expect(outboundLimits({})).toEqual({
      email: { perHour: 20, perDay: 80 },
      sms: { perHour: 5, perDay: 20 },
    });
  });
});
