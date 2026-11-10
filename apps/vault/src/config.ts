import { LocalKeyProvider, type KeyProvider } from './crypto/envelope.js';
import { parseKey, parseKeyring, type Keyring } from './crypto/keys.js';
import {
  InMemoryTwoFactorProvider,
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
  twoFactor: TwoFactorProvider;
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
    throw new Error('Production requires VAULT_KEK_PROVIDER=kms (KMS adapter not yet implemented)');
  }
  if (production) {
    // The SheerID adapter does not exist yet; until it does, production must not start,
    // even if SheerID credentials are present (otherwise the fake verifier would run).
    throw new Error('Production requires the SheerID verifier adapter (not yet implemented)');
  }

  const twoFactor: TwoFactorProvider = env.TWILIO_VERIFY_SERVICE_SID
    ? new TwilioVerifyProvider({
        accountSid: required(env, 'TWILIO_ACCOUNT_SID'),
        authToken: required(env, 'TWILIO_AUTH_TOKEN'),
        serviceSid: env.TWILIO_VERIFY_SERVICE_SID,
      })
    : production
      ? (() => {
          throw new Error('Production requires Twilio Verify credentials');
        })()
      : new InMemoryTwoFactorProvider();

  return {
    host: env.VAULT_HOST ?? '127.0.0.1',
    port: Number(env.VAULT_PORT ?? '3100'),
    logLevel: env.LOG_LEVEL ?? (production ? 'info' : 'debug'),
    databaseUrl: required(env, 'VAULT_DATABASE_URL'),
    serviceToken: required(env, 'VAULT_SERVICE_TOKEN'),
    tokenKeys: parseKeyring(env.VAULT_TOKEN_KEYS, 'VAULT_TOKEN_KEYS'),
    lookupKey: parseKey(env.VAULT_LOOKUP_KEY, 'VAULT_LOOKUP_KEY'),
    keyProvider: new LocalKeyProvider(parseKey(env.VAULT_LOCAL_KEK, 'VAULT_LOCAL_KEK')),
    verifier: new FakeVerifier(), // replaced by the SheerID adapter once access is granted
    twoFactor,
  };
}
