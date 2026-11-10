/**
 * Email delivery for 2FA codes. Only delivery is outsourced; codes are
 * generated, stored (hashed) and checked by the vault itself (otp.ts).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Resend adapter (https://resend.com/docs/api-reference/emails/send-email):
 * POST https://api.resend.com/emails, Bearer API key, JSON {from, to, subject, text}.
 * Free plan: 3,000 emails/month, 100/day (https://resend.com/pricing).
 * Sending requires a verified domain for the `from` address.
 */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey.startsWith('re_')) throw new Error('Resend API keys start with "re_"');
  }

  async send(message: EmailMessage): Promise<void> {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!res.ok) throw new Error(`Resend send failed with HTTP ${res.status}`);
  }
}

/** Test sender: keeps messages in memory. */
export class InMemoryEmailSender implements EmailSender {
  readonly outbox: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.outbox.push(message);
  }
  /** The most recent 6-digit code sent to `to`, for tests. */
  lastCode(to: string): string | undefined {
    const msg = [...this.outbox].reverse().find((m) => m.to === to);
    return msg?.text.match(/\b(\d{6})\b/)?.[1];
  }
}

/**
 * Development sender: prints codes to the vault's own terminal so local
 * sign-ups work without any email account. Refused in production (config.ts).
 */
export class DevConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage) {
    process.stdout.write(
      `\n[dev email] to=${message.to} subject="${message.subject}"\n${message.text}\n\n`,
    );
  }
}
