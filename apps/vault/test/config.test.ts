import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadVaultConfig } from '../src/config.js';
import { InMemoryTwoFactorProvider, TwilioVerifyProvider } from '../src/providers/two-factor.js';

const key = () => randomBytes(32).toString('base64');
const dev = () => ({
  VAULT_DATABASE_URL: 'postgres://x',
  VAULT_SERVICE_TOKEN: 'x'.repeat(40),
  VAULT_TOKEN_KEYS: `1:${key()}`,
  VAULT_LOOKUP_KEY: key(),
  VAULT_LOCAL_KEK: key(),
});

describe('vault config', () => {
  it('uses development stand-ins when no providers are configured', () => {
    const c = loadVaultConfig(dev());
    expect(c.twoFactor).toBeInstanceOf(InMemoryTwoFactorProvider);
    expect(c.port).toBe(3100);
  });

  it('uses Twilio Verify when its credentials are present', () => {
    const c = loadVaultConfig({
      ...dev(),
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 't',
      TWILIO_VERIFY_SERVICE_SID: 'VA1',
    });
    expect(c.twoFactor).toBeInstanceOf(TwilioVerifyProvider);
  });

  it('fails closed in production without real providers and a KMS', () => {
    expect(() => loadVaultConfig({ ...dev(), NODE_ENV: 'production' })).toThrow(/KMS|kms/);
    expect(() =>
      loadVaultConfig({ ...dev(), NODE_ENV: 'production', VAULT_KEK_PROVIDER: 'kms' }),
    ).toThrow(/SheerID/);
    // Credentials alone must not let the fake verifier run in production.
    expect(() =>
      loadVaultConfig({
        ...dev(),
        NODE_ENV: 'production',
        VAULT_KEK_PROVIDER: 'kms',
        SHEERID_ACCESS_TOKEN: 'present',
      }),
    ).toThrow(/not yet implemented/);
  });

  it('requires every secret', () => {
    const missing: Record<string, string | undefined> = dev();
    delete missing.VAULT_LOOKUP_KEY;
    expect(() => loadVaultConfig(missing)).toThrow(/VAULT_LOOKUP_KEY/);
  });
});
