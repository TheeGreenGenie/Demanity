/**
 * Identity verification provider (ADR 0004). The production adapter targets
 * SheerID's Driver License + Age segments; it is added once SheerID grants
 * account access, and plugs in behind this interface without other changes.
 */

export interface VerificationRequest {
  firstName: string;
  lastName: string;
  birthDate: string; // YYYY-MM-DD
  state: string;
  licenseNumber: string;
}

export type VerificationOutcome =
  | { status: 'approved' }
  | { status: 'rejected'; reason: 'not_verified' | 'under_18' | 'fraud_signal' }
  | { status: 'needs_review' }; // routed to the moderator queue

export interface IdentityVerifier {
  verify(request: VerificationRequest): Promise<VerificationOutcome>;
}

export const MIN_AGE = 18;

/** Whole years between birthDate and `now` (UTC). Throws on malformed dates. */
export function ageInYears(birthDate: string, now: Date = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) throw new Error('birthDate must be YYYY-MM-DD');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    throw new Error('birthDate is not a real date');
  }
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() < mo - 1 || (now.getUTCMonth() === mo - 1 && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Development stand-in that mimics the documented SheerID outcomes.
 * License numbers starting with "REJECT" are rejected; "REVIEW" go to review.
 * Never use outside development and tests.
 */
export class FakeVerifier implements IdentityVerifier {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async verify(req: VerificationRequest): Promise<VerificationOutcome> {
    if (ageInYears(req.birthDate, this.now()) < MIN_AGE) {
      return { status: 'rejected', reason: 'under_18' };
    }
    const n = req.licenseNumber.toUpperCase();
    if (n.startsWith('REJECT')) return { status: 'rejected', reason: 'not_verified' };
    if (n.startsWith('REVIEW')) return { status: 'needs_review' };
    return { status: 'approved' };
  }
}
