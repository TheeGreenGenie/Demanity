import { createHmac } from 'node:crypto';
import type { Keyring } from './keys.js';

/**
 * Uniqueness token (ADR 0002). A keyed one-way hash of identity attributes,
 * computed in memory; raw attributes are never stored or logged.
 *
 * Security rests on the secrecy of the HMAC keys, not of this algorithm,
 * which is public in this open-source repository.
 */

// USPS codes accepted by SheerID's `state` field for US driver's licenses:
// 50 states, DC, and inhabited territories.
const US_STATE_CODES = new Set(
  (
    'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ ' +
    'NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR GU VI AS MP'
  ).split(' '),
);

export interface LicenseAttributes {
  state: string;
  licenseNumber: string;
}

export class InvalidAttributesError extends Error {}

export function normalizeLicense(attrs: LicenseAttributes): string {
  const state = attrs.state.trim().toUpperCase();
  if (!US_STATE_CODES.has(state)) {
    throw new InvalidAttributesError('Unsupported or invalid US state code');
  }
  const number = attrs.licenseNumber.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z0-9*]{4,20}$/.test(number)) {
    throw new InvalidAttributesError('Invalid license number format');
  }
  // Domain-separated input so this hash can never collide with other token types.
  return `demanity:uniq:us-dl:v1|${state}|${number}`;
}

export interface UniquenessToken {
  version: number;
  digest: Buffer;
}

function hmac(key: Buffer, input: string): Buffer {
  return createHmac('sha256', key).update(input, 'utf8').digest();
}

/** Token under the current key version (used when creating an identity). */
export function computeToken(keyring: Keyring, attrs: LicenseAttributes): UniquenessToken {
  const input = normalizeLicense(attrs);
  return { version: keyring.current.version, digest: hmac(keyring.current.key, input) };
}

/** Tokens under every loaded key version (used for duplicate checks across rotations). */
export function computeAllTokens(keyring: Keyring, attrs: LicenseAttributes): UniquenessToken[] {
  const input = normalizeLicense(attrs);
  return [...keyring.all].map(([version, key]) => ({ version, digest: hmac(key, input) }));
}
