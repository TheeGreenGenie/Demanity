import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadVaultConfig } from '../src/config.js';
import { AwsKmsKeyProvider } from '../src/crypto/kms.js';
import { DevConsoleEmailSender, ResendEmailSender } from '../src/providers/email.js';
import { TwilioVerifyProvider } from '../src/providers/two-factor.js';

const key = () => randomBytes(32).toString('base64');
const dev = () => ({
  VAULT_DATABASE_URL: 'postgres://x',
  VAULT_SERVICE_TOKEN: 'x'.repeat(40),
  VAULT_TOKEN_KEYS: `1:${key()}`,
  VAULT_LOOKUP_KEY: key(),
  VAULT_LOCAL_KEK: key(),
});

describe('vault config', () => {
  it('defaults to free email 2FA with a dev console sender and no SMS', () => {
    const c = loadVaultConfig(dev());
    expect(c.emailSender).toBeInstanceOf(DevConsoleEmailSender);
    expect(c.sms).toBeNull();
    expect(c.port).toBe(3100);
  });

  it('uses Resend only when EMAIL_DELIVERY=resend is set explicitly', () => {
    const resend = {
      ...dev(),
      EMAIL_DELIVERY: 'resend',
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'Demanity <codes@example.org>',
    };
    expect(loadVaultConfig(resend).emailSender).toBeInstanceOf(ResendEmailSender);
    expect(() => loadVaultConfig({ ...resend, EMAIL_FROM: undefined })).toThrow(/EMAIL_FROM/);
    expect(() => loadVaultConfig({ ...resend, RESEND_API_KEY: undefined })).toThrow(
      /RESEND_API_KEY/,
    );
    // A key in .env alone never sends real email outside production.
    expect(
      loadVaultConfig({ ...dev(), RESEND_API_KEY: 're_test', EMAIL_FROM: 'x@example.org' })
        .emailSender,
    ).toBeInstanceOf(DevConsoleEmailSender);
    expect(() => loadVaultConfig({ ...dev(), EMAIL_DELIVERY: 'carrier-pigeon' })).toThrow(
      /EMAIL_DELIVERY/,
    );
  });

  it('enables optional SMS via Twilio Verify only when credentials are present', () => {
    const c = loadVaultConfig({
      ...dev(),
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 't',
      TWILIO_VERIFY_SERVICE_SID: 'VA1',
    });
    expect(c.sms).toBeInstanceOf(TwilioVerifyProvider);
  });

  it('fails closed in production without real providers and a KMS', () => {
    expect(() => loadVaultConfig({ ...dev(), NODE_ENV: 'production' })).toThrow(/KMS|kms/);
    expect(() =>
      loadVaultConfig({
        ...dev(),
        NODE_ENV: 'production',
        VAULT_KEK_PROVIDER: 'kms',
        AWS_REGION: 'us-east-1',
        VAULT_KMS_KEY_ID: 'alias/demanity-vault',
      }),
    ).toThrow(/SheerID/);
    // Credentials alone must not let the fake verifier run in production.
    expect(() =>
      loadVaultConfig({
        ...dev(),
        NODE_ENV: 'production',
        VAULT_KEK_PROVIDER: 'kms',
        AWS_REGION: 'us-east-1',
        VAULT_KMS_KEY_ID: 'alias/demanity-vault',
        SHEERID_ACCESS_TOKEN: 'present',
      }),
    ).toThrow(/not yet implemented/);
  });

  it('uses AWS KMS when VAULT_KEK_PROVIDER=kms', () => {
    const c = loadVaultConfig({
      ...dev(),
      VAULT_KEK_PROVIDER: 'kms',
      AWS_REGION: 'us-east-1',
      VAULT_KMS_KEY_ID: 'alias/demanity-vault',
    });
    expect(c.keyProvider).toBeInstanceOf(AwsKmsKeyProvider);
    expect(c.keyProvider.kekId).toBe('aws-kms:alias/demanity-vault');
    expect(() =>
      loadVaultConfig({ ...dev(), VAULT_KEK_PROVIDER: 'kms', AWS_REGION: 'us-east-1' }),
    ).toThrow(/VAULT_KMS_KEY_ID/);
  });

  it('requires every secret', () => {
    const missing: Record<string, string | undefined> = dev();
    delete missing.VAULT_LOOKUP_KEY;
    expect(() => loadVaultConfig(missing)).toThrow(/VAULT_LOOKUP_KEY/);
  });
});
