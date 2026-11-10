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

export type CommunityKind = 'topic' | 'location' | 'humanity';
export type ReactionKind = 'like' | 'dislike' | 'kudos';

export interface Community {
  slug: string;
  name: string;
  kind: CommunityKind;
  description: string;
  followers: number;
  following: boolean;
}

export interface Post {
  id: string;
  community: { slug: string; name: string; kind: CommunityKind };
  author: { username: string } | null;
  title: string;
  body: string | null;
  status: 'visible' | 'removed';
  removedReason: string | null;
  createdAt: string;
  counts: { like: number; dislike: number; kudos: number; comments: number };
  myReaction: ReactionKind | null;
  reason?: string;
}

export interface Comment {
  id: string;
  parentId: string | null;
  author: { username: string } | null;
  body: string | null;
  status: 'visible' | 'removed';
  createdAt: string;
  likes: number;
  dislikes: number;
  kudos: number;
  myReaction: ReactionKind | null;
}

export interface Page<T> {
  next: string | null;
  posts: T[];
}

export interface Profile extends Page<Post> {
  username: string;
  joined: string;
  followers: number;
  following: boolean;
}

const q = (cursor?: string | null) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');

export const social = {
  communities: (token: string | null, kind?: CommunityKind) =>
    request<{ communities: Community[] }>('GET', `/v1/communities${kind ? `?kind=${kind}` : ''}`, {
      token,
    }),
  community: (token: string | null, slug: string) =>
    request<Community>('GET', `/v1/communities/${slug}`, { token }),
  communityPosts: (token: string | null, slug: string, cursor?: string | null) =>
    request<Page<Post>>('GET', `/v1/communities/${slug}/posts${q(cursor)}`, { token }),
  feed: (token: string, cursor?: string | null) =>
    request<Page<Post>>('GET', `/v1/feed${q(cursor)}`, { token }),
  post: (token: string | null, id: string) => request<Post>('GET', `/v1/posts/${id}`, { token }),
  comments: (token: string | null, id: string) =>
    request<{ comments: Comment[] }>('GET', `/v1/posts/${id}/comments`, { token }),
  createPost: (token: string, slug: string, title: string, body: string) =>
    request<Post>('POST', `/v1/communities/${slug}/posts`, { token, body: { title, body } }),
  createComment: (token: string, postId: string, body: string, parentId?: string) =>
    request<Comment>('POST', `/v1/posts/${postId}/comments`, {
      token,
      body: parentId ? { body, parentId } : { body },
    }),
  react: (token: string, targetType: 'post' | 'comment', targetId: string, kind: ReactionKind) =>
    request<void>('PUT', '/v1/reactions', { token, body: { targetType, targetId, kind } }),
  unreact: (token: string, targetType: 'post' | 'comment', targetId: string) =>
    request<void>('DELETE', '/v1/reactions', { token, body: { targetType, targetId } }),
  follow: (token: string, kind: 'community' | 'user', name: string) =>
    request<void>('PUT', `/v1/follows/${kind}/${name}`, { token }),
  unfollow: (token: string, kind: 'community' | 'user', name: string) =>
    request<void>('DELETE', `/v1/follows/${kind}/${name}`, { token }),
  user: (token: string | null, username: string) =>
    request<Profile>('GET', `/v1/users/${username}`, { token }),
};

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
    request<{ credentialId: string; token: string }>('POST', '/v1/me/passkeys', {
      token,
      body: { response },
    }),
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
    reaction_not_allowed_here: 'That reaction isn’t available here.',
    post_removed: 'This post was removed by moderators.',
    cannot_follow_self: 'You can’t follow yourself.',
    not_found: 'That could not be found.',
  };
  if (err.status === 429) return 'Too many attempts. Please wait a little and try again.';
  return messages[err.code] ?? 'Something went wrong. Please try again.';
}
