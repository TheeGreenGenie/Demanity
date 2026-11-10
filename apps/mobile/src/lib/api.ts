/**
 * Typed client for the Demanity API. Only the API URL comes from the bundle
 * (EXPO_PUBLIC_ values are public by design); no secrets live in the app.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:3000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export type AccountStatus = 'pending' | 'verified' | 'active' | 'banned';
export type SessionScope = 'onboarding' | 'recovery' | 'full';

export interface Me {
  username: string;
  status: AccountStatus;
  scope: SessionScope;
}

export interface IdentityForm {
  firstName: string;
  lastName: string;
  birthDate: string; // YYYY-MM-DD
  state: string;
  licenseNumber: string;
}

async function request<T>(
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) throw new ApiError(res.status, String(json.error ?? 'request_failed'), json);
  return json as T;
}

export const api = {
  signUp: (username: string) =>
    request<{ token: string; status: AccountStatus }>('POST', '/v1/accounts', {
      body: { username },
    }),
  me: (token: string) => request<Me>('GET', '/v1/me', { token }),
  verifyIdentity: (token: string, form: IdentityForm) =>
    request<{ status: string; review?: string }>('POST', '/v1/me/verification', {
      token,
      body: form,
    }),
  setEmail: (token: string, value: string) =>
    request<{ status: string }>('PUT', '/v1/me/contacts/email', { token, body: { value } }),
  confirmEmail: (token: string, code: string) =>
    request<{ status: string }>('POST', '/v1/me/contacts/email/confirm', { token, body: { code } }),
  passkeyRegistrationOptions: (token: string) =>
    request<Record<string, unknown>>('POST', '/v1/me/passkeys/options', { token }),
  registerPasskey: (token: string, response: unknown) =>
    request<{ credentialId: string }>('POST', '/v1/me/passkeys', { token, body: { response } }),
  passkeySignInOptions: () =>
    request<{ challengeId: string; options: Record<string, unknown> }>(
      'POST',
      '/v1/auth/passkey/options',
    ),
  passkeySignIn: (challengeId: string, response: unknown) =>
    request<{ token: string }>('POST', '/v1/auth/passkey', { body: { challengeId, response } }),
  signOut: (token: string) => request<void>('POST', '/v1/auth/logout', { token }),
};

/** Human-readable messages for API error codes shown in the UI. */
export function describeError(err: unknown): string {
  if (!(err instanceof ApiError))
    return 'Something went wrong. Check your connection and try again.';
  const messages: Record<string, string> = {
    username_taken: 'That username is taken.',
    duplicate_identity:
      'This identity already has a Demanity account. Each person may have only one.',
    banned: 'This identity is not allowed to use Demanity.',
    under_18: 'You must be 18 or older to join Demanity.',
    not_verified: 'We could not verify that license. Check the details and try again.',
    verification_denied: 'Your verification was reviewed and denied.',
    invalid_code: 'That code is incorrect or has expired.',
    too_many_codes: 'Too many codes requested. Please wait an hour and try again.',
    contact_in_use: 'That email is already used by another account.',
    invalid_input: 'Some details are not valid. Please check them.',
    challenge_expired: 'That took too long. Please try again.',
    unknown_credential: 'This passkey is not registered with Demanity.',
    verification_failed: 'Passkey verification failed. Please try again.',
    sign_in_required: 'Please sign in first.',
  };
  if (err.status === 429) return 'Too many attempts. Please wait a little and try again.';
  return messages[err.code] ?? 'Something went wrong. Please try again.';
}
