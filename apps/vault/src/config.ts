import {
  CappedEmailSender,
  CappedTwoFactor,
  OutboundCap,
  outboundLimits,
} from './providers/outbound-cap.js';
import type { Pool } from '@demanity/db';
import { KMSClient } from '@aws-sdk/client-kms';
import { LocalKeyProvider, type KeyProvider } from './crypto/envelope.js';
import { AwsKmsKeyProvider } from './crypto/kms.js';
import { parseKey, parseKeyring, type Keyring } from './crypto/keys.js';
import { DevConsoleEmailSender, ResendEmailSender, type EmailSender } from './providers/email.js';
import { EmailOtpProvider } from './providers/otp.js';
import {
  ChannelRouter,
  TwilioVerifyProvider,
  type TwoFactorProvider,
} from './providers/two-factor.js';
import { FakeVerifier, type IdentityVerifier } from './providers/verifier.js';

export interface VaultConfig {
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  serviceToken: string;
  tokenKeys: Keyring;
  lookupKey: Buffer;
  keyProvider: KeyProvider;
  verifier: IdentityVerifier;
  emailSender: EmailSender;
  /** Optional, paid after Twilio's free trial: only enabled when credentials are set. */
  sms: TwilioVerifyProvider | null;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export function loadVaultConfig(env: NodeJS.ProcessEnv = process.env): VaultConfig {
  const production = env.NODE_ENV === 'production';

  // Fail closed: production may never run on development stand-ins.
  if (production && env.VAULT_KEK_PROVIDER !== 'kms') {
    throw new Error('Production requires VAULT_KEK_PROVIDER=kms (AWS KMS)');
  }

  // Key-encryption key: AWS KMS in production; a local key only in development.
  // AWS credentials come from the standard provider chain (e.g. the task's IAM role),
  // never from this config.
  const keyProvider: KeyProvider =
    env.VAULT_KEK_PROVIDER === 'kms'
      ? new AwsKmsKeyProvider(
          new KMSClient({ region: required(env, 'AWS_REGION') }),
          required(env, 'VAULT_KMS_KEY_ID'),
        )
      : new LocalKeyProvider(parseKey(env.VAULT_LOCAL_KEK, 'VAULT_LOCAL_KEK'));
  if (production) {
    // The SheerID adapter does not exist yet; until it does, production must not start,
    // even if SheerID credentials are present (otherwise the fake verifier would run).
    throw new Error('Production requires the SheerID verifier adapter (not yet implemented)');
  }

  // Email 2FA (default, free): vault-generated codes. Delivery is explicit:
  // EMAIL_DELIVERY=resend sends real email; anything else outside production
  // prints codes to the console. Having a Resend key in .env is not enough on
  // its own, so tests and demos never send real email by accident.
  const delivery = env.EMAIL_DELIVERY ?? (production ? 'resend' : 'console');
  if (delivery !== 'resend' && delivery !== 'console')
    throw new Error('EMAIL_DELIVERY must be "resend" or "console"');
  if (production && delivery !== 'resend')
    throw new Error(
      'Production requires EMAIL_DELIVERY=resend (with RESEND_API_KEY and EMAIL_FROM)',
    );
  let emailSender: EmailSender;
  if (delivery === 'resend') {
    emailSender = new ResendEmailSender(
      required(env, 'RESEND_API_KEY'),
      required(env, 'EMAIL_FROM'),
    );
  } else {
    emailSender = new DevConsoleEmailSender();
  }

  // SMS 2FA (optional): Twilio Verify, intended for the free trial only.
  const sms = env.TWILIO_VERIFY_SERVICE_SID
    ? new TwilioVerifyProvider({
        accountSid: required(env, 'TWILIO_ACCOUNT_SID'),
        authToken: required(env, 'TWILIO_AUTH_TOKEN'),
        serviceSid: env.TWILIO_VERIFY_SERVICE_SID,
      })
    : null;

  return {
    host: env.VAULT_HOST ?? '127.0.0.1',
    port: Number(env.VAULT_PORT ?? '3100'),
    logLevel: env.LOG_LEVEL ?? (production ? 'info' : 'debug'),
    databaseUrl: required(env, 'VAULT_DATABASE_URL'),
    serviceToken: required(env, 'VAULT_SERVICE_TOKEN'),
    tokenKeys: parseKeyring(env.VAULT_TOKEN_KEYS, 'VAULT_TOKEN_KEYS'),
    lookupKey: parseKey(env.VAULT_LOOKUP_KEY, 'VAULT_LOOKUP_KEY'),
    keyProvider,
    verifier: new FakeVerifier(), // replaced by the SheerID adapter once access is granted
    emailSender,
    sms,
  };
}

/** Email is always available (free); SMS only when Twilio is configured. */
export function buildTwoFactor(
  config: VaultConfig,
  pool: Pool,
  env: NodeJS.ProcessEnv = process.env,
): TwoFactorProvider {
  // Service-wide caps keep us inside provider quotas (providers/outbound-cap.ts).
  const limits = outboundLimits(env);
  // Only real providers have quotas; the development console sender is uncapped.
  const email =
    config.emailSender instanceof ResendEmailSender
      ? new CappedEmailSender(config.emailSender, new OutboundCap(pool, 'email', limits.email))
      : config.emailSender;
  return new ChannelRouter({
    email: new EmailOtpProvider(pool, config.lookupKey, email),
    ...(config.sms
      ? { sms: new CappedTwoFactor(config.sms, new OutboundCap(pool, 'sms', limits.sms)) }
      : {}),
  });
}
