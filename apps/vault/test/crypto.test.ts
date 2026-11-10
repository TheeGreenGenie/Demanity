import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, LocalKeyProvider } from '../src/crypto/envelope.js';
import { parseKey, parseKeyring } from '../src/crypto/keys.js';
import { lookupHash, normalizeEmail, normalizeUsPhone } from '../src/crypto/lookup.js';
import {
  computeAllTokens,
  computeToken,
  InvalidAttributesError,
  normalizeLicense,
} from '../src/crypto/token.js';

const k = () => randomBytes(32).toString('base64');

describe('keyring', () => {
  it('uses the highest version as current', () => {
    const ring = parseKeyring(`1:${k()},3:${k()},2:${k()}`, 'KEYS');
    expect(ring.current.version).toBe(3);
    expect(ring.all.size).toBe(3);
  });

  it('rejects short keys, malformed and duplicate entries', () => {
    expect(() => parseKeyring('1:c2hvcnQ=', 'KEYS')).toThrow(/32 bytes/);
    expect(() => parseKeyring('nope', 'KEYS')).toThrow(/malformed/);
    const key = k();
    expect(() => parseKeyring(`1:${key},1:${key}`, 'KEYS')).toThrow(/duplicate/);
    expect(() => parseKeyring(undefined, 'KEYS')).toThrow(/required/);
    expect(() => parseKey('c2hvcnQ=', 'K')).toThrow(/32 bytes/);
  });
});

describe('uniqueness token', () => {
  const ring = parseKeyring(`1:${k()}`, 'KEYS');

  it('is deterministic and ignores formatting differences', () => {
    const a = computeToken(ring, { state: 'ca', licenseNumber: 'd123-4567 ' });
    const b = computeToken(ring, { state: ' CA', licenseNumber: 'D1234567' });
    expect(a.digest.equals(b.digest)).toBe(true);
    expect(a.digest).toHaveLength(32);
  });

  it('differs across states and numbers', () => {
    const a = computeToken(ring, { state: 'CA', licenseNumber: 'D1234567' });
    const b = computeToken(ring, { state: 'NY', licenseNumber: 'D1234567' });
    const c = computeToken(ring, { state: 'CA', licenseNumber: 'D1234568' });
    expect(a.digest.equals(b.digest)).toBe(false);
    expect(a.digest.equals(c.digest)).toBe(false);
  });

  it('does not contain the raw attributes', () => {
    const t = computeToken(ring, { state: 'CA', licenseNumber: 'D1234567' });
    expect(t.digest.toString('latin1')).not.toContain('D1234567');
    expect(t.digest.toString('hex')).not.toContain(Buffer.from('D1234567').toString('hex'));
  });

  it('depends on the secret key', () => {
    const other = parseKeyring(`1:${k()}`, 'KEYS');
    const attrs = { state: 'CA', licenseNumber: 'D1234567' };
    expect(computeToken(ring, attrs).digest.equals(computeToken(other, attrs).digest)).toBe(false);
  });

  it('still matches old tokens after key rotation', () => {
    const v1 = k();
    const before = parseKeyring(`1:${v1}`, 'KEYS');
    const after = parseKeyring(`1:${v1},2:${k()}`, 'KEYS');
    const attrs = { state: 'TX', licenseNumber: '12345678' };
    const old = computeToken(before, attrs);
    const candidates = computeAllTokens(after, attrs);
    expect(candidates.some((c) => c.version === 1 && c.digest.equals(old.digest))).toBe(true);
    expect(computeToken(after, attrs).version).toBe(2);
  });

  it('rejects invalid states and license formats', () => {
    expect(() => normalizeLicense({ state: 'XX', licenseNumber: 'D1234567' })).toThrow(
      InvalidAttributesError,
    );
    expect(() => normalizeLicense({ state: 'CA', licenseNumber: '12' })).toThrow(
      InvalidAttributesError,
    );
    expect(() => normalizeLicense({ state: 'CA', licenseNumber: 'D12;DROP' })).toThrow(
      InvalidAttributesError,
    );
  });
});

describe('envelope encryption', () => {
  const provider = new LocalKeyProvider(randomBytes(32));

  it('round-trips', async () => {
    const env = await encrypt(provider, 'person@example.com', 'contact:abc');
    expect(env.data).not.toContain('person');
    expect(await decrypt(provider, env, 'contact:abc')).toBe('person@example.com');
  });

  it('uses a fresh data key and IV each time', async () => {
    const a = await encrypt(provider, 'same', 'aad');
    const b = await encrypt(provider, 'same', 'aad');
    expect(a.data).not.toBe(b.data);
    expect(a.wrappedDek).not.toBe(b.wrappedDek);
  });

  it('fails with the wrong AAD (row swapping is detected)', async () => {
    const env = await encrypt(provider, 'secret', 'contact:row-1');
    await expect(decrypt(provider, env, 'contact:row-2')).rejects.toThrow();
  });

  it('fails on tampered ciphertext', async () => {
    const env = await encrypt(provider, 'secret', 'aad');
    const bytes = Buffer.from(env.data, 'base64');
    bytes[bytes.length - 1]! ^= 0x01;
    await expect(
      decrypt(provider, { ...env, data: bytes.toString('base64') }, 'aad'),
    ).rejects.toThrow();
  });

  it('fails under a different KEK', async () => {
    const env = await encrypt(provider, 'secret', 'aad');
    const other = new LocalKeyProvider(randomBytes(32));
    await expect(decrypt(other, env, 'aad')).rejects.toThrow();
  });
});

describe('lookup hashes and normalization', () => {
  const key = randomBytes(32);

  it('separates purposes', () => {
    const a = lookupHash(key, 'contact:email', 'x');
    const b = lookupHash(key, 'account', 'x');
    expect(a.equals(b)).toBe(false);
  });

  it('normalizes emails and US phones', () => {
    expect(normalizeEmail('  Person@Example.COM ')).toBe('person@example.com');
    expect(() => normalizeEmail('not-an-email')).toThrow();
    expect(normalizeUsPhone('(415) 555-2671')).toBe('+14155552671');
    expect(normalizeUsPhone('+1 415 555 2671')).toBe('+14155552671');
    expect(() => normalizeUsPhone('+44 20 7946 0958')).toThrow();
    expect(() => normalizeUsPhone('123')).toThrow();
  });
});
