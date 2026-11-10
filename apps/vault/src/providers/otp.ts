import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Pool } from '@demanity/db';
import { lookupHash } from '../crypto/lookup.js';
import type { EmailSender } from './email.js';
import type { Channel, TwoFactorProvider } from './two-factor.js';

/**
 * Free email 2FA: the vault generates and verifies its own one-time codes and
 * only uses an email service for delivery.
 *
 * - 6 random digits from a CSPRNG (node:crypto randomInt)
 * - stored only as an HMAC, keyed by a vault secret and bound to the destination
 * - expire after 10 minutes, single use
 * - locked after 5 wrong guesses (per code), and at most 5 codes per hour per destination
 */
export const OTP_POLICY = {
  digits: 6,
  ttlSeconds: 10 * 60,
  maxAttempts: 5,
  maxSendsPerWindow: 5,
  windowSeconds: 60 * 60,
} as const;

export class OtpRateLimitedError extends Error {
  constructor() {
    super('too_many_codes');
  }
}

export class EmailOtpProvider implements TwoFactorProvider {
  constructor(
    private readonly pool: Pool,
    private readonly key: Buffer,
    private readonly sender: EmailSender,
    private readonly now: () => Date = () => new Date(),
  ) {}

  supports(channel: Channel): boolean {
    return channel === 'email';
  }

  private destination(to: string): Buffer {
    return lookupHash(this.key, 'otp', to);
  }

  private codeHash(destination: Buffer, code: string): Buffer {
    return createHmac('sha256', this.key)
      .update('demanity:otp:v1|')
      .update(destination)
      .update(`|${code}`)
      .digest();
  }

  async start(to: string, channel: Channel): Promise<void> {
    if (channel !== 'email') throw new Error('EmailOtpProvider only handles email');
    const destination = this.destination(to);
    const code = randomInt(0, 10 ** OTP_POLICY.digits)
      .toString()
      .padStart(OTP_POLICY.digits, '0');
    const now = this.now();

    // Upsert a fresh code; reset or bump the per-window send counter atomically.
    const { rows } = await this.pool.query<{ sends_in_window: number }>(
      `INSERT INTO otp_challenges (destination, code_hash, attempts, expires_at, sends_in_window, window_started_at)
       VALUES ($1, $2, 0, $3, 1, $4)
       ON CONFLICT (destination) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         attempts = 0,
         expires_at = EXCLUDED.expires_at,
         sends_in_window = CASE
           WHEN otp_challenges.window_started_at <= $4 - make_interval(secs => $5) THEN 1
           ELSE otp_challenges.sends_in_window + 1 END,
         window_started_at = CASE
           WHEN otp_challenges.window_started_at <= $4 - make_interval(secs => $5) THEN $4
           ELSE otp_challenges.window_started_at END
       WHERE otp_challenges.window_started_at <= $4 - make_interval(secs => $5)
          OR otp_challenges.sends_in_window < $6
       RETURNING sends_in_window`,
      [
        destination,
        this.codeHash(destination, code),
        new Date(now.getTime() + OTP_POLICY.ttlSeconds * 1000),
        now,
        OTP_POLICY.windowSeconds,
        OTP_POLICY.maxSendsPerWindow,
      ],
    );
    // No row returned means the WHERE guard blocked the update: limit reached.
    if (rows.length === 0) throw new OtpRateLimitedError();

    await this.sender.send({
      to,
      subject: 'Your Demanity verification code',
      text:
        `Your Demanity verification code is ${code}\n\n` +
        `It expires in ${OTP_POLICY.ttlSeconds / 60} minutes. ` +
        `If you didn't request it, you can ignore this email. Demanity will never ask you for this code.`,
    });
  }

  async check(to: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const destination = this.destination(to);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        code_hash: Buffer;
        attempts: number;
        expires_at: Date;
      }>(
        'SELECT code_hash, attempts, expires_at FROM otp_challenges WHERE destination = $1 FOR UPDATE',
        [destination],
      );
      const row = rows[0];
      if (!row || row.expires_at <= this.now() || row.attempts >= OTP_POLICY.maxAttempts) {
        await client.query('COMMIT');
        return false;
      }
      const ok = timingSafeEqual(row.code_hash, this.codeHash(destination, code));
      if (ok) {
        // Single use: invalidate the code but keep the send counter for rate limiting.
        await client.query(
          'UPDATE otp_challenges SET expires_at = to_timestamp(0), attempts = $2 WHERE destination = $1',
          [destination, OTP_POLICY.maxAttempts],
        );
      } else {
        await client.query(
          'UPDATE otp_challenges SET attempts = attempts + 1 WHERE destination = $1',
          [destination],
        );
      }
      await client.query('COMMIT');
      return ok;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
