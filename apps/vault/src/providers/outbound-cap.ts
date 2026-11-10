import type { Pool } from '@demanity/db';
import { lookupHash } from '../crypto/lookup.js';
import type { EmailMessage, EmailSender } from './email.js';
import { OtpRateLimitedError } from './otp.js';
import type { Channel, TwoFactorProvider } from './two-factor.js';

/**
 * Service-wide caps on outbound messages. Per-address limits (5 codes/hour)
 * already exist; these stop many different addresses from together using up
 * a provider's quota. Reserved atomically in Postgres for both the current
 * hour and the current day; if either is full, nothing is counted and the
 * caller gets "too many codes, try later" (HTTP 429).
 */
export interface OutboundLimits {
  perHour: number;
  perDay: number;
}

export class OutboundCap {
  constructor(
    private readonly pool: Pool,
    readonly provider: 'email' | 'sms',
    readonly limits: OutboundLimits,
  ) {}

  async reserve(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [kind, limit] of [
        ['hour', this.limits.perHour],
        ['day', this.limits.perDay],
      ] as const) {
        const { rows } = await client.query(
          `INSERT INTO outbound_usage (provider, window_kind, window_start, sent)
           VALUES ($1, $2, date_trunc($2, now()), 1)
           ON CONFLICT (provider, window_kind, window_start)
             DO UPDATE SET sent = outbound_usage.sent + 1 WHERE outbound_usage.sent < $3
           RETURNING sent`,
          [this.provider, kind, limit],
        );
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          throw new OtpRateLimitedError();
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

export class CappedEmailSender implements EmailSender {
  constructor(
    private readonly inner: EmailSender,
    private readonly cap: OutboundCap,
  ) {}
  async send(message: EmailMessage): Promise<void> {
    await this.cap.reserve();
    await this.inner.send(message);
  }
}

/**
 * Per-destination caps (SMS): at most `perHour` / `perDay` codes to one phone
 * number, whoever asks. The number is kept only as a keyed hash.
 */
export class DestinationCap {
  constructor(
    private readonly pool: Pool,
    private readonly key: Buffer,
    readonly limits: OutboundLimits,
  ) {}

  async reserve(to: string): Promise<void> {
    const destination = lookupHash(this.key, 'sms-cap', to);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "DELETE FROM outbound_destination_usage WHERE window_start < now() - interval '2 days'",
      );
      for (const [kind, limit] of [
        ['hour', this.limits.perHour],
        ['day', this.limits.perDay],
      ] as const) {
        const { rows } = await client.query(
          `INSERT INTO outbound_destination_usage (destination, window_kind, window_start, sent)
           VALUES ($1, $2, date_trunc($2, now()), 1)
           ON CONFLICT (destination, window_kind, window_start)
             DO UPDATE SET sent = outbound_destination_usage.sent + 1
             WHERE outbound_destination_usage.sent < $3
           RETURNING sent`,
          [destination, kind, limit],
        );
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          throw new OtpRateLimitedError();
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Caps only `start` (which sends a message); checking a code sends nothing. */
export class CappedTwoFactor implements TwoFactorProvider {
  constructor(
    private readonly inner: TwoFactorProvider,
    private readonly cap: OutboundCap,
    private readonly perDestination?: DestinationCap,
  ) {}
  supports(channel: Channel) {
    return this.inner.supports(channel);
  }
  async start(to: string, channel: Channel) {
    // Per-number first, so one flooded number can't use up the shared quota.
    await this.perDestination?.reserve(to);
    await this.cap.reserve();
    await this.inner.start(to, channel);
  }
  check(to: string, code: string, channel: Channel) {
    return this.inner.check(to, code, channel);
  }
}

/**
 * Defaults stay inside free tiers. Resend's free plan allows 100 emails/day
 * (resend.com/pricing, recorded in email.ts); we stop at 80. SMS is kept
 * very small for the Twilio trial. All four are configurable.
 */
export function outboundLimits(env: NodeJS.ProcessEnv = process.env) {
  const num = (name: string, fallback: number) => {
    const v = Number(env[name]);
    return Number.isInteger(v) && v > 0 ? v : fallback;
  };
  return {
    email: { perHour: num('VAULT_EMAIL_PER_HOUR', 20), perDay: num('VAULT_EMAIL_PER_DAY', 80) },
    sms: { perHour: num('VAULT_SMS_PER_HOUR', 5), perDay: num('VAULT_SMS_PER_DAY', 20) },
    // Codes to any one phone number, whoever asks.
    smsPerNumber: {
      perHour: num('VAULT_SMS_PER_NUMBER_PER_HOUR', 3),
      perDay: num('VAULT_SMS_PER_NUMBER_PER_DAY', 6),
    },
  };
}
