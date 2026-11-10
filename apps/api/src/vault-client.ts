/**
 * Client for the internal identity vault (apps/vault). The API forwards
 * identity data to the vault in memory and never stores or logs it.
 */

export type VaultErrorCode =
  | 'duplicate_identity'
  | 'banned'
  | 'not_verified'
  | 'under_18'
  | 'unknown_account'
  | 'contact_in_use'
  | 'no_contact'
  | 'invalid_input'
  | 'channel_unavailable'
  | 'too_many_codes'
  | 'internal';

export class VaultClientError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    readonly status: number,
  ) {
    super(`vault: ${code}`);
  }
}

export interface IdentityPayload {
  firstName: string;
  lastName: string;
  birthDate: string;
  state: string;
  licenseNumber: string;
}

export type Channel = 'sms' | 'email';

export interface Vault {
  verifyIdentity(
    accountId: string,
    person: IdentityPayload,
    override?: { reasonCode: string },
  ): Promise<'verified' | 'needs_review'>;
  matchIdentity(
    accountId: string,
    attrs: { state: string; licenseNumber: string },
  ): Promise<boolean>;
  ban(accountId: string, reasonCode: string): Promise<void>;
  setContact(accountId: string, channel: Channel, value: string): Promise<void>;
  startTwoFactor(accountId: string, channel: Channel): Promise<void>;
  checkTwoFactor(accountId: string, channel: Channel, code: string): Promise<boolean>;
}

export class HttpVaultClient implements Vault {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.serviceToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status >= 400) {
      let code: VaultErrorCode = 'internal';
      try {
        code = ((await res.json()) as { error?: VaultErrorCode }).error ?? 'internal';
      } catch {
        // non-JSON error body
      }
      throw new VaultClientError(code, res.status);
    }
    return res;
  }

  async verifyIdentity(
    accountId: string,
    person: IdentityPayload,
    override?: { reasonCode: string },
  ) {
    const res = await this.call('POST', '/v1/identities/verify', {
      accountId,
      ...person,
      ...(override ? { override } : {}),
    });
    return res.status === 202 ? 'needs_review' : 'verified';
  }

  async matchIdentity(accountId: string, attrs: { state: string; licenseNumber: string }) {
    const res = await this.call('POST', '/v1/identities/match', { accountId, ...attrs });
    return ((await res.json()) as { match: boolean }).match;
  }

  async ban(accountId: string, reasonCode: string) {
    await this.call('POST', `/v1/accounts/${accountId}/ban`, { reasonCode });
  }

  async setContact(accountId: string, channel: Channel, value: string) {
    await this.call('PUT', `/v1/accounts/${accountId}/contacts/${channel}`, { value });
  }

  async startTwoFactor(accountId: string, channel: Channel) {
    await this.call('POST', `/v1/accounts/${accountId}/2fa/${channel}/start`);
  }

  async checkTwoFactor(accountId: string, channel: Channel, code: string) {
    const res = await this.call('POST', `/v1/accounts/${accountId}/2fa/${channel}/check`, { code });
    return ((await res.json()) as { approved: boolean }).approved;
  }
}
