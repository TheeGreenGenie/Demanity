import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Pool } from '@demanity/db';
import type { ChallengeStore } from './challenges.js';

/**
 * Passkeys (WebAuthn) via SimpleWebAuthn v14. User verification (biometric or
 * device PIN) is required on every ceremony; this is the device half of the
 * "two-way handshake" voting will rely on (R6).
 */

export interface RelyingParty {
  id: string; // e.g. "demanity.org" (localhost in development)
  name: string;
  origins: string[];
}

const CHALLENGE_TTL = 300;

export class PasskeyError extends Error {
  constructor(readonly code: 'challenge_expired' | 'verification_failed' | 'unknown_credential') {
    super(code);
  }
}

export class Passkeys {
  constructor(
    private readonly pool: Pool,
    private readonly challenges: ChallengeStore,
    private readonly rp: RelyingParty,
  ) {}

  async registrationOptions(accountId: string) {
    const { rows } = await this.pool.query<{ username: string; webauthn_user_id: Buffer }>(
      'SELECT username, webauthn_user_id FROM accounts WHERE id = $1',
      [accountId],
    );
    const account = rows[0]!;
    const existing = await this.pool.query<{ id: string; transports: string[] }>(
      'SELECT id, transports FROM passkeys WHERE account_id = $1 AND revoked_at IS NULL',
      [accountId],
    );
    const options = await generateRegistrationOptions({
      rpName: this.rp.name,
      rpID: this.rp.id,
      userName: account.username,
      userID: new Uint8Array(account.webauthn_user_id),
      attestationType: 'none',
      excludeCredentials: existing.rows.map((p) => ({ id: p.id, transports: p.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    await this.challenges.put(`reg:${accountId}`, options.challenge, CHALLENGE_TTL);
    return options;
  }

  /** Registers a passkey. With `revokeOthers` (account recovery), all older passkeys stop working. */
  async register(accountId: string, response: RegistrationResponseJSON, revokeOthers = false) {
    const expectedChallenge = await this.challenges.take(`reg:${accountId}`);
    if (!expectedChallenge) throw new PasskeyError('challenge_expired');

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.rp.origins,
        expectedRPID: this.rp.id,
        requireUserVerification: true,
      });
    } catch {
      throw new PasskeyError('verification_failed');
    }
    if (!verification.verified) throw new PasskeyError('verification_failed');

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (revokeOthers) {
        await client.query(
          'UPDATE passkeys SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL',
          [accountId],
        );
      }
      await client.query(
        `INSERT INTO passkeys (id, account_id, public_key, counter, transports, device_type, backed_up)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          credential.id,
          accountId,
          Buffer.from(credential.publicKey),
          credential.counter,
          credential.transports ?? [],
          credentialDeviceType,
          credentialBackedUp,
        ],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return { credentialId: credential.id };
  }

  /** Discoverable-credential sign-in: the client needs no username. */
  async authenticationOptions(challengeId: string) {
    const options = await generateAuthenticationOptions({
      rpID: this.rp.id,
      userVerification: 'required',
    });
    await this.challenges.put(`auth:${challengeId}`, options.challenge, CHALLENGE_TTL);
    return options;
  }

  async authenticate(challengeId: string, response: AuthenticationResponseJSON): Promise<string> {
    const expectedChallenge = await this.challenges.take(`auth:${challengeId}`);
    if (!expectedChallenge) throw new PasskeyError('challenge_expired');

    const { rows } = await this.pool.query<{
      account_id: string;
      public_key: Buffer;
      counter: string;
      transports: string[];
    }>(
      `SELECT p.account_id, p.public_key, p.counter, p.transports
         FROM passkeys p JOIN accounts a ON a.id = p.account_id
        WHERE p.id = $1 AND p.revoked_at IS NULL AND a.status <> 'banned'`,
      [response.id],
    );
    const stored = rows[0];
    if (!stored) throw new PasskeyError('unknown_credential');

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.rp.origins,
        expectedRPID: this.rp.id,
        requireUserVerification: true,
        credential: {
          id: response.id,
          publicKey: new Uint8Array(stored.public_key),
          counter: Number(stored.counter),
          transports: stored.transports,
        },
      });
    } catch {
      throw new PasskeyError('verification_failed');
    }
    if (!verification.verified) throw new PasskeyError('verification_failed');

    await this.pool.query('UPDATE passkeys SET counter = $1, last_used_at = now() WHERE id = $2', [
      verification.authenticationInfo.newCounter,
      response.id,
    ]);
    return stored.account_id;
  }
}
