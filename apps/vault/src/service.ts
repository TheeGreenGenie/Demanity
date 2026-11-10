import type { Pool } from '@demanity/db';
import { decrypt, encrypt, type Envelope, type KeyProvider } from './crypto/envelope.js';
import type { Keyring } from './crypto/keys.js';
import { lookupHash, normalizeEmail, normalizeUsPhone } from './crypto/lookup.js';
import { computeAllTokens, computeToken, type LicenseAttributes } from './crypto/token.js';
import type { Channel, TwoFactorProvider } from './providers/two-factor.js';
import {
  ageInYears,
  MIN_AGE,
  type IdentityVerifier,
  type VerificationRequest,
} from './providers/verifier.js';

export class VaultError extends Error {
  constructor(
    readonly code:
      | 'duplicate_identity'
      | 'banned'
      | 'not_verified'
      | 'under_18'
      | 'needs_review'
      | 'unknown_account'
      | 'contact_in_use'
      | 'no_contact'
      | 'invalid_input',
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface VaultDeps {
  pool: Pool;
  tokenKeys: Keyring;
  lookupKey: Buffer;
  keyProvider: KeyProvider;
  verifier: IdentityVerifier;
  twoFactor: TwoFactorProvider;
  now?: () => Date;
}

type IdentityStatus = 'available' | 'registered' | 'banned';

export class VaultService {
  constructor(private readonly d: VaultDeps) {}

  private accountLookup(accountId: string): Buffer {
    return lookupHash(this.d.lookupKey, 'account', accountId);
  }

  private async audit(action: string, identityId: string | null, actor: string, reason?: string) {
    await this.d.pool.query(
      'INSERT INTO audit_log (action, identity_id, actor, reason_code) VALUES ($1, $2, $3, $4)',
      [action, identityId, actor, reason ?? null],
    );
  }

  /** Duplicate check across all token key versions. Runs before any paid provider call. */
  async identityStatus(attrs: LicenseAttributes): Promise<IdentityStatus> {
    const tokens = computeAllTokens(this.d.tokenKeys, attrs);
    const { rows } = await this.d.pool.query<{ status: string }>(
      `SELECT status FROM identities
        WHERE (token_version, token) IN (SELECT * FROM unnest($1::smallint[], $2::bytea[]))`,
      [tokens.map((t) => t.version), tokens.map((t) => t.digest)],
    );
    if (rows.length === 0) return 'available';
    return rows.some((r) => r.status === 'banned') ? 'banned' : 'registered';
  }

  /**
   * Full sign-up verification:
   * 1. duplicate/ban check (no provider cost for repeat attempts)
   * 2. 18+ check and provider verification
   * 3. create the identity bound to the pseudonymous account
   * Raw attributes exist only in memory for the duration of this call.
   */
  async verifyAndRegister(
    accountId: string,
    req: VerificationRequest,
  ): Promise<{ identityId: string }> {
    const attrs = { state: req.state, licenseNumber: req.licenseNumber };
    const status = await this.identityStatus(attrs);
    if (status === 'banned') throw new VaultError('banned');
    if (status === 'registered') throw new VaultError('duplicate_identity');

    if (ageInYears(req.birthDate, this.d.now?.() ?? new Date()) < MIN_AGE) {
      throw new VaultError('under_18');
    }

    const outcome = await this.d.verifier.verify(req);
    if (outcome.status === 'needs_review') throw new VaultError('needs_review');
    if (outcome.status === 'rejected') {
      throw new VaultError(outcome.reason === 'under_18' ? 'under_18' : 'not_verified');
    }

    const token = computeToken(this.d.tokenKeys, attrs);
    try {
      const { rows } = await this.d.pool.query<{ id: string }>(
        `INSERT INTO identities (token_version, token, account_lookup)
         VALUES ($1, $2, $3) RETURNING id`,
        [token.version, token.digest, this.accountLookup(accountId)],
      );
      const identityId = rows[0]!.id;
      await this.audit('identity.created', identityId, 'system');
      return { identityId };
    } catch (err) {
      // A concurrent registration of the same person loses the race on the unique constraint.
      if ((err as { code?: string }).code === '23505') throw new VaultError('duplicate_identity');
      throw err;
    }
  }

  private async identityForAccount(accountId: string): Promise<{ id: string; status: string }> {
    const { rows } = await this.d.pool.query<{ id: string; status: string }>(
      'SELECT id, status FROM identities WHERE account_lookup = $1',
      [this.accountLookup(accountId)],
    );
    if (!rows[0]) throw new VaultError('unknown_account');
    return rows[0];
  }

  private normalizeContact(kind: Channel, value: string): string {
    try {
      return kind === 'email' ? normalizeEmail(value) : normalizeUsPhone(value);
    } catch (err) {
      throw new VaultError('invalid_input', (err as Error).message);
    }
  }

  private static kindOf(channel: Channel): 'email' | 'phone' {
    return channel === 'email' ? 'email' : 'phone';
  }

  /** Stores (or replaces) the account's email or phone, encrypted. Unverified until a code is checked. */
  async setContact(accountId: string, channel: Channel, value: string): Promise<void> {
    const identity = await this.identityForAccount(accountId);
    const kind = VaultService.kindOf(channel);
    const normalized = this.normalizeContact(channel, value);
    const envelope = await encrypt(
      this.d.keyProvider,
      normalized,
      `contact:${identity.id}:${kind}`,
    );
    const hash = lookupHash(this.d.lookupKey, `contact:${kind}`, normalized);
    try {
      await this.d.pool.query(
        `INSERT INTO contacts (identity_id, kind, lookup_hash, envelope)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (identity_id, kind)
         DO UPDATE SET lookup_hash = EXCLUDED.lookup_hash, envelope = EXCLUDED.envelope,
                       verified_at = NULL, created_at = now()`,
        [identity.id, kind, hash, JSON.stringify(envelope)],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new VaultError('contact_in_use');
      throw err;
    }
    await this.audit('contact.set', identity.id, 'user', kind);
  }

  private async contactValue(
    accountId: string,
    channel: Channel,
  ): Promise<{ identityId: string; to: string }> {
    const identity = await this.identityForAccount(accountId);
    const kind = VaultService.kindOf(channel);
    const { rows } = await this.d.pool.query<{ envelope: Envelope }>(
      'SELECT envelope FROM contacts WHERE identity_id = $1 AND kind = $2',
      [identity.id, kind],
    );
    if (!rows[0]) throw new VaultError('no_contact');
    const to = await decrypt(
      this.d.keyProvider,
      rows[0].envelope,
      `contact:${identity.id}:${kind}`,
    );
    return { identityId: identity.id, to };
  }

  async startTwoFactor(accountId: string, channel: Channel): Promise<void> {
    const { to } = await this.contactValue(accountId, channel);
    await this.d.twoFactor.start(to, channel);
  }

  async checkTwoFactor(accountId: string, channel: Channel, code: string): Promise<boolean> {
    if (!/^\d{4,10}$/.test(code)) return false;
    const { identityId, to } = await this.contactValue(accountId, channel);
    const ok = await this.d.twoFactor.check(to, code);
    if (ok) {
      await this.d.pool.query(
        'UPDATE contacts SET verified_at = now() WHERE identity_id = $1 AND kind = $2',
        [identityId, VaultService.kindOf(channel)],
      );
    }
    await this.audit(ok ? 'twofactor.passed' : 'twofactor.failed', identityId, 'user', channel);
    return ok;
  }

  /** True when the account has at least one verified 2FA contact (required by R26). */
  async hasVerifiedContact(accountId: string): Promise<boolean> {
    const identity = await this.identityForAccount(accountId);
    const { rows } = await this.d.pool.query(
      'SELECT 1 FROM contacts WHERE identity_id = $1 AND verified_at IS NOT NULL LIMIT 1',
      [identity.id],
    );
    return rows.length > 0;
  }

  /** Permanent ban: the identity token stays, so the person can never re-register. */
  async ban(accountId: string, actor: string, reasonCode: string): Promise<void> {
    const identity = await this.identityForAccount(accountId);
    await this.d.pool.query("UPDATE identities SET status = 'banned' WHERE id = $1", [identity.id]);
    await this.audit('identity.banned', identity.id, actor, reasonCode);
  }
}
