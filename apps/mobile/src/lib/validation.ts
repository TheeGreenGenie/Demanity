/**
 * Client-side form checks with human-readable messages. The server validates
 * everything again; these exist so a person always learns what to fix
 * instead of facing a disabled button.
 */

const US_STATES = new Set(
  (
    'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ ' +
    'NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR GU VI AS MP'
  ).split(' '),
);

/** Accepts MM/DD/YYYY (US style) or YYYY-MM-DD; returns YYYY-MM-DD or null. */
export function parseBirthDate(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  const us = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (us) [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])];
  else if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  if (y < 1900 || date > new Date()) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export interface IdentityInput {
  firstName: string;
  lastName: string;
  birthDate: string;
  state: string;
  licenseNumber: string;
}

export function validateIdentity(f: IdentityInput): FieldErrors<keyof IdentityInput> {
  const e: FieldErrors<keyof IdentityInput> = {};
  if (!f.firstName.trim()) e.firstName = 'Enter your first name as it appears on your license.';
  if (!f.lastName.trim()) e.lastName = 'Enter your last name as it appears on your license.';
  if (!parseBirthDate(f.birthDate))
    e.birthDate = 'Use the format MM/DD/YYYY, for example 07/04/1990.';
  if (!US_STATES.has(f.state.trim().toUpperCase()))
    e.state = 'Use the two-letter state code from your license, for example CA.';
  const lic = f.licenseNumber.trim().replace(/[\s-]/g, '');
  if (lic.length < 4) e.licenseNumber = 'Enter the full license number (at least 4 characters).';
  else if (!/^[A-Za-z0-9*]+$/.test(lic))
    e.licenseNumber = 'Use only the letters and numbers from your license.';
  return e;
}

export function validateUsername(u: string): string | null {
  if (u.length < 3) return 'At least 3 characters.';
  if (u.length > 30) return 'At most 30 characters.';
  if (!/^[a-z0-9_]+$/.test(u)) return 'Only lowercase letters, numbers and underscores.';
  return null;
}

export function validateEmail(e: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())
    ? null
    : 'Enter a valid email address, like name@example.com.';
}
