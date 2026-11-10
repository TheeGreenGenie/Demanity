import { createHmac } from 'node:crypto';

/**
 * Keyed lookup hashes. They let the vault find a row by a value (an email,
 * phone or account ID) without storing that value in readable form. Without
 * the vault's lookup key, the hashes reveal nothing and cannot be joined with
 * the activity database.
 */

export type LookupPurpose = 'contact:email' | 'contact:phone' | 'account' | 'otp' | 'sms-cap';

export function lookupHash(key: Buffer, purpose: LookupPurpose, value: string): Buffer {
  return createHmac('sha256', key).update(`demanity:lookup:${purpose}|${value}`, 'utf8').digest();
}

export function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  // Deliberately simple: one @, non-empty local and domain parts, a dot in the domain.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) {
    throw new Error('Invalid email address');
  }
  return e;
}

/** US numbers only (eligibility is US-based). Returns E.164, e.g. +15551234567. */
export function normalizeUsPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) {
    throw new Error('Invalid US phone number');
  }
  return `+1${national}`;
}
