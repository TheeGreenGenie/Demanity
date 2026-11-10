/**
 * 2FA code delivery. The vault is the only service that ever decrypts a
 * contact value, and it hands that value only to this provider.
 */
export type Channel = 'sms' | 'email';

export interface TwoFactorProvider {
  /** Whether this provider can deliver codes on `channel`. */
  supports(channel: Channel): boolean;
  start(to: string, channel: Channel): Promise<void>;
  /** Returns true only when the code is correct and unexpired. */
  check(to: string, code: string, channel: Channel): Promise<boolean>;
}

/**
 * Twilio Verify adapter (https://www.twilio.com/docs/verify/api).
 * - Start: POST /v2/Services/{ServiceSid}/Verifications       (To, Channel)
 * - Check: POST /v2/Services/{ServiceSid}/VerificationCheck   (To, Code) -> status "approved"
 *   A missing or expired verification returns 404, which is treated as a failed check.
 */
export class TwilioVerifyProvider implements TwoFactorProvider {
  private readonly base: string;
  private readonly auth: string;

  constructor(
    opts: { accountSid: string; authToken: string; serviceSid: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!opts.serviceSid.startsWith('VA'))
      throw new Error('Twilio Verify service SID must start with VA');
    this.base = `https://verify.twilio.com/v2/Services/${encodeURIComponent(opts.serviceSid)}`;
    this.auth = `Basic ${Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64')}`;
  }

  supports(channel: Channel): boolean {
    return channel === 'sms';
  }

  private post(path: string, form: Record<string, string>) {
    return this.fetchImpl(`${this.base}/${path}`, {
      method: 'POST',
      headers: {
        authorization: this.auth,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    });
  }

  async start(to: string, channel: Channel): Promise<void> {
    const res = await this.post('Verifications', { To: to, Channel: channel });
    if (!res.ok) throw new Error(`Twilio Verify start failed with HTTP ${res.status}`);
  }

  async check(to: string, code: string): Promise<boolean> {
    const res = await this.post('VerificationCheck', { To: to, Code: code });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`Twilio Verify check failed with HTTP ${res.status}`);
    const body = (await res.json()) as { status?: string };
    return body.status === 'approved';
  }
}

/** Development/test provider: records codes in memory instead of sending them. */
export class InMemoryTwoFactorProvider implements TwoFactorProvider {
  readonly sent = new Map<string, { code: string; channel: Channel }>();

  constructor(private readonly generate: () => string = () => '123456') {}

  supports(): boolean {
    return true;
  }

  async start(to: string, channel: Channel): Promise<void> {
    this.sent.set(to, { code: this.generate(), channel });
  }

  async check(to: string, code: string): Promise<boolean> {
    const entry = this.sent.get(to);
    if (!entry || entry.code !== code) return false;
    this.sent.delete(to); // single use
    return true;
  }
}

/**
 * Routes each channel to its provider. Email (default, free) uses the vault's
 * own codes; SMS uses Twilio Verify only when credentials are configured.
 */
export class ChannelRouter implements TwoFactorProvider {
  constructor(private readonly routes: Partial<Record<Channel, TwoFactorProvider>>) {}

  supports(channel: Channel): boolean {
    return this.routes[channel]?.supports(channel) ?? false;
  }

  private route(channel: Channel): TwoFactorProvider {
    const p = this.routes[channel];
    if (!p) throw new Error(`No 2FA provider for channel ${channel}`);
    return p;
  }

  start(to: string, channel: Channel) {
    return this.route(channel).start(to, channel);
  }

  check(to: string, code: string, channel: Channel) {
    return this.route(channel).check(to, code, channel);
  }
}
