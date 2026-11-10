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
  /** Detail only: number of visible posts and the linked place page, if any. */
  posts?: number;
  place?: string | null;
}

export type PostSort = 'hot' | 'new' | 'top';

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
  communityPosts: (
    token: string | null,
    slug: string,
    cursor?: string | null,
    sort: PostSort = 'new',
  ) =>
    request<Page<Post>>(
      'GET',
      `/v1/communities/${slug}/posts?sort=${sort}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      { token },
    ),
  feed: (token: string, cursor?: string | null) =>
    request<Feed>('GET', `/v1/feed${q(cursor)}`, { token }),
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
  follow: (token: string, kind: FollowKind, name: string) =>
    request<void>('PUT', `/v1/follows/${kind}/${name}`, { token }),
  unfollow: (token: string, kind: FollowKind, name: string) =>
    request<void>('DELETE', `/v1/follows/${kind}/${name}`, { token }),
  user: (token: string | null, username: string) =>
    request<Profile>('GET', `/v1/users/${username}`, { token }),
};

// --- Civic: places, leaders, bills, guides, search -------------------------------

export type PlaceKind =
  'nation' | 'state' | 'county' | 'city' | 'court_district' | 'congressional_district';

export interface Overall {
  /** Places: living conditions. Leaders: trust (record vs. stated positions). */
  kind: 'conditions' | 'trust';
  score: number | null;
  categoriesCounted: number;
  categoriesExcluded: number;
  peers: { rank: number; count: number } | null;
  peerGroup: string;
  peerLabel: string;
  method: string;
}

export interface CategoryScore {
  category: { slug: string; name: string };
  /** False when the category doesn't apply at this level of government (never scored). */
  applicable: boolean;
  score: number | null;
  rationale: string | null;
  evidence: { label: string; url: string | null }[];
  evidenceCount: number;
  lowEvidence: boolean;
  methodVersion: string | null;
  asOf: string | null;
  isSample: boolean;
  peers: { rank: number; count: number; average: number } | null;
}

export interface Scores {
  kind: 'conditions' | 'trust';
  subjectKind: string;
  peerLabel: string;
  peerGroup: string;
  overall: Overall;
  categories: CategoryScore[];
}

export interface LeaderSummary {
  slug: string;
  name: string;
  office: string;
  party: string;
  isSample: boolean;
  overall: number | null;
}

export type BillStage = 'proposed' | 'voting' | 'decided';

export interface BillFilter {
  scope?: 'federal' | 'state';
  place?: string;
  category?: string;
  stage?: BillStage;
  bipartisan?: boolean;
}

export interface Bill {
  id: string;
  number: string;
  title: string;
  summary: string;
  /** Plain-language "what changes for you". */
  impact: string;
  status: string;
  stage: BillStage;
  level: 'federal' | 'state';
  /** Deck and feed only: why this bill is shown to you. */
  reason?: string;
  introducedAt: string;
  lastActionAt: string;
  sourceUrl: string | null;
  isSample: boolean;
  place: { slug: string; name: string };
  category: { slug: string; name: string } | null;
  sponsors: { slug: string; name: string; party: string; role: string }[];
  bipartisan: boolean;
  weighedIn: boolean;
  tally: { support: number; oppose: number } | null;
}

export interface Stat {
  key: string;
  label: string;
  value: number;
  unit: 'usd' | 'usd_month' | 'usd_year' | 'percent' | 'index' | 'minutes';
  higherIsBetter: boolean;
  sourceLabel: string;
  sourceUrl: string | null;
  asOf: string | null;
  isSample: boolean;
  peerMedian: number | null;
  peerCount: number;
}

export interface Place {
  slug: string;
  name: string;
  kind: PlaceKind;
  population: number | null;
  /** Court-district pages only: latest published opinions (CourtListener). */
  rulings: CourtCase[] | null;
  /** Court-district pages only: newest case filings, PACER dockets (CourtListener). */
  filings: CourtCase[] | null;
  peerGroup: string;
  peerLabel: string;
  cost: {
    basicsMonthly: number;
    peerMedian: number | null;
    peerCount: number | null;
    realIncome: number | null;
    gallonsPerMonth: number;
    formula: string;
  } | null;
  isSample: boolean;
  parent: { slug: string; name: string } | null;
  community: string | null;
  children: { slug: string; name: string; kind: PlaceKind }[];
  overall: Overall;
  issues: {
    rank: number;
    title: string;
    summary: string;
    sourceLabel: string;
    sourceUrl: string | null;
    isSample: boolean;
    categorySlug: string | null;
    categoryName: string | null;
  }[];
  elections: {
    id: string;
    candidates: number;
    office: string;
    kind: string;
    electionDate: string;
    sourceLabel: string;
    sourceUrl: string | null;
    isSample: boolean;
  }[];
  leaders: LeaderSummary[];
  stats: Stat[];
  recentBills: Bill[];
}

/** A court case with its formal citation and the link to its source. */
export interface CourtCase {
  caseName: string;
  docketNumber: string;
  courtCitation: string;
  dateFiled: string;
  /** Bluebook-style, e.g. "Doe v. Roe, No. 2:26-cv-1 (C.D. Cal. filed Nov. 10, 2026)". */
  citation: string;
  url: string;
  sourceName: string;
}

export interface Leader {
  claimed: boolean;
  slug: string;
  name: string;
  office: string;
  officeKind: string;
  party: string;
  inOffice: boolean;
  bio: string;
  isSample: boolean;
  place: { slug: string; name: string } | null;
  overall: Overall;
  passed: Bill[];
  sponsored: Bill[];
}

export type RequestStatus = 'open' | 'acknowledged' | 'responded' | 'done';

export interface LeaderRequest {
  id: string;
  title: string;
  body: string;
  status: RequestStatus;
  response: string | null;
  respondedAt: string | null;
  mergedCount: number;
  /** Days since the request reached the must-respond threshold without an answer. */
  awaitingResponseDays: number | null;
  createdAt: string;
  author: { username: string } | null;
  votes: number;
  myVote: boolean;
}

export interface GuideSummary {
  slug: string;
  topic: string;
  title: string;
  summary: string;
  readingMinutes: number;
}

export interface Guide extends GuideSummary {
  body: string;
  sources: { label: string; url: string }[];
  updatedAt: string;
}

export interface SearchResults {
  communities: { slug: string; name: string; kind: CommunityKind }[];
  places: { slug: string; name: string; kind: PlaceKind }[];
  leaders: { slug: string; name: string; office: string; party: string }[];
  bills: Bill[];
  posts: { id: string; title: string; communitySlug: string; communityName: string }[];
}

export interface Election {
  id: string;
  office: string;
  kind: string;
  electionDate: string;
  sourceLabel: string;
  sourceUrl: string | null;
  isSample: boolean;
  place: { slug: string; name: string };
  voted: boolean;
  closed: boolean;
  total: number | null;
  candidates: {
    id: string;
    name: string;
    party: string;
    leaderSlug: string | null;
    votes: number | null;
    actualPct: number | null;
  }[];
  meanAbsoluteErrorPoints: number | null;
}

export interface Citation {
  id: string;
  categorySlug: string;
  categoryName: string;
  direction: 'positive' | 'negative';
  claim: string;
  sourceUrl: string;
  sourceName: string;
  actionDate: string;
  /** "Contributor", or "Cited by <leader>" when a leader submitted it. */
  attribution: string;
  accurateYes: number;
  accurateNo: number;
  approveYes: number;
  approveNo: number;
  /** Wilson lower bound of the accuracy votes (what the score uses). */
  strength: number;
  votedAccurate: boolean;
  votedApprove: boolean;
}

export interface PendingCitation {
  id: string;
  leaderSlug: string;
  leaderName: string;
  categorySlug: string;
  direction: 'positive' | 'negative';
  claim: string;
  sourceUrl: string;
  sourceDomain: string;
  actionDate: string;
  byLeader: boolean;
}

export interface Freshness {
  sources: {
    source: string;
    syncedThrough: string | null;
    lastSuccessAt: string | null;
    healthy: boolean;
  }[];
}

export interface ContributorStatus {
  grants: { category: string; categoryName: string; expiresAt: string }[];
  applications: {
    id: string;
    category: string;
    categoryName: string;
    status: 'pending' | 'approved' | 'rejected';
    reasonCode: string | null;
    createdAt: string;
  }[];
}

export interface PendingApplication {
  id: string;
  category: string;
  categoryName: string;
  essay: string;
  createdAt: string;
}

export interface PendingClaim {
  id: string;
  leaderSlug: string;
  leaderName: string;
  office: string;
  username: string;
  evidence: string;
  createdAt: string;
}

export interface LeaderViewer {
  isLeader: boolean;
  claimPending: boolean;
  claimed: boolean;
}

export type FollowKind = 'community' | 'user' | 'leader' | 'place' | 'bill';

export interface FollowedItem {
  kind: 'leader' | 'place' | 'bill';
  id: string;
  name: string;
  caption: string;
}

export interface Feed extends Page<Post> {
  updates?: Bill[];
  following?: FollowedItem[];
}

const billQuery = (f: BillFilter) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f))
    if (v !== undefined && v !== false) params.set(k, String(v));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

export const civic = {
  place: (token: string | null, slug: string) =>
    request<Place>('GET', `/v1/places/${slug}`, { token }),
  placeScores: (token: string | null, slug: string) =>
    request<Scores>('GET', `/v1/places/${slug}/scores`, { token }),
  leader: (token: string | null, slug: string) =>
    request<Leader>('GET', `/v1/leaders/${slug}`, { token }),
  leaderScores: (token: string | null, slug: string) =>
    request<Scores>('GET', `/v1/leaders/${slug}/scores`, { token }),
  requests: (token: string | null, slug: string) =>
    request<{ threshold: number; requests: LeaderRequest[] }>(
      'GET',
      `/v1/leaders/${slug}/requests`,
      { token },
    ),
  createRequest: (token: string, slug: string, title: string, body: string) =>
    request<{ id: string }>('POST', `/v1/leaders/${slug}/requests`, {
      token,
      body: body ? { title, body } : { title },
    }),
  voteRequest: (token: string, id: string) =>
    request<void>('PUT', `/v1/leader-requests/${id}/vote`, { token }),
  unvoteRequest: (token: string, id: string) =>
    request<void>('DELETE', `/v1/leader-requests/${id}/vote`, { token }),
  bills: (token: string | null, filter: BillFilter = {}) =>
    request<{ bills: Bill[] }>('GET', `/v1/bills${billQuery(filter)}`, { token }),
  deck: (token: string, filter: BillFilter = {}) =>
    request<{ bills: Bill[] }>('GET', `/v1/bills/deck${billQuery(filter)}`, { token }),
  bill: (token: string | null, id: string) => request<Bill>('GET', `/v1/bills/${id}`, { token }),
  stance: (token: string, id: string, stance: 'support' | 'oppose') =>
    request<{ tally: { support: number; oppose: number } }>('POST', `/v1/bills/${id}/stance`, {
      token,
      body: { stance },
    }),
  election: (token: string | null, id: string) =>
    request<Election>('GET', `/v1/elections/${id}`, { token }),
  castMockBallot: (token: string, id: string, candidateId: string) =>
    request<{ status: string }>('POST', `/v1/elections/${id}/ballot`, {
      token,
      body: { candidateId, residentAttested: true },
    }),
  followStatus: (token: string | null, kind: FollowKind, name: string) =>
    request<{ following: boolean }>('GET', `/v1/follows/${kind}/${encodeURIComponent(name)}`, {
      token,
    }),
  citations: (token: string | null, slug: string, category?: string) =>
    request<{ citations: Citation[] }>(
      'GET',
      `/v1/leaders/${slug}/citations${category ? `?category=${category}` : ''}`,
      { token },
    ),
  submitCitation: (
    token: string,
    slug: string,
    body: {
      category: string;
      direction: 'positive' | 'negative';
      claim: string;
      sourceUrl: string;
      actionDate: string;
    },
  ) =>
    request<{ id: string; status: string }>('POST', `/v1/leaders/${slug}/citations`, {
      token,
      body,
    }),
  voteCitation: (token: string, id: string, kind: 'accurate' | 'approve', value: boolean) =>
    request<{ accurateYes: number; accurateNo: number; approveYes: number; approveNo: number }>(
      'POST',
      `/v1/citations/${id}/votes`,
      { token, body: { kind, value } },
    ),
  pendingCitations: (token: string) =>
    request<{ citations: PendingCitation[] }>('GET', '/v1/moderation/citations', { token }),
  decideCitation: (token: string, id: string, decision: 'accept' | 'reject', reasonCode: string) =>
    request<{ status: string }>('POST', `/v1/moderation/citations/${id}/decision`, {
      token,
      body: { decision, reasonCode },
    }),
  sources: () =>
    request<{ sources: { domain: string; name: string; tier: number }[]; note: string }>(
      'GET',
      '/v1/sources',
    ),
  freshness: () => request<Freshness>('GET', '/v1/data-freshness'),
  applyToContribute: (token: string, category: string, essay: string) =>
    request<{ id: string; status: string }>('POST', '/v1/contributor-applications', {
      token,
      body: { category, essay },
    }),
  myContributor: (token: string) => request<ContributorStatus>('GET', '/v1/me/contributor', { token }),
  pendingApplications: (token: string) =>
    request<{ applications: PendingApplication[] }>('GET', '/v1/moderation/contributor-applications', {
      token,
    }),
  decideApplication: (token: string, id: string, decision: 'approve' | 'reject', reasonCode: string) =>
    request<{ status: string }>('POST', `/v1/moderation/contributor-applications/${id}/decision`, {
      token,
      body: { decision, reasonCode },
    }),
  leaderViewer: (token: string | null, slug: string) =>
    request<LeaderViewer>('GET', `/v1/leaders/${slug}/viewer`, { token }),
  claimLeader: (token: string, slug: string, evidence: string) =>
    request<{ id: string; status: string }>('POST', `/v1/leaders/${slug}/claims`, {
      token,
      body: { evidence },
    }),
  pendingClaims: (token: string) =>
    request<{ claims: PendingClaim[] }>('GET', '/v1/moderation/leader-claims', { token }),
  decideClaim: (token: string, id: string, decision: 'approve' | 'reject', reasonCode: string) =>
    request<{ status: string }>('POST', `/v1/moderation/leader-claims/${id}/decision`, {
      token,
      body: { decision, reasonCode },
    }),
  updateRequest: (
    token: string,
    id: string,
    body: { status: 'acknowledged' | 'responded' | 'done'; response?: string },
  ) => request<{ status: string }>('PATCH', `/v1/leader-requests/${id}`, { token, body }),
  guides: () => request<{ guides: GuideSummary[] }>('GET', '/v1/guides'),
  guide: (slug: string) => request<Guide>('GET', `/v1/guides/${slug}`),
  search: (token: string | null, q: string) =>
    request<SearchResults>('GET', `/v1/search?q=${encodeURIComponent(q)}`, { token }),
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
    already_voted: 'You already voted on this.',
    application_pending: 'You already have an application waiting for review in this topic.',
    already_contributor: 'You’re already a contributor in this topic.',
    claim_pending: 'A claim for this page is already being reviewed.',
    already_claimed: 'This page has already been claimed.',
    already_a_leader: 'Your account is already linked to a leader page.',
    response_required: 'Write a response first.',
    not_allowed: 'You can’t do that.',
    contributors_only:
      'Only contributors approved for this topic can add citations. Contributors apply with a short essay.',
    self_citation: 'Leaders can’t cite themselves.',
    source_not_approved:
      'That source isn’t on the approved list. Use an official (.gov) source, a court record, AP, Reuters or C-SPAN.',
    category_not_applicable: 'That topic doesn’t apply to this office.',
    action_date_in_future: 'The date of the action can’t be in the future.',
    moderator_only: 'Only moderators can do that.',
    cannot_decide_own_case: 'You can’t review your own submission.',
    election_closed: 'This election has already happened.',
    already_weighed_in: 'You already weighed in on this bill. Stances can�t be changed.',
    leader_not_in_office: 'This leader is no longer in office.',
  };
  if (err.status === 429) return 'Too many attempts. Please wait a little and try again.';
  return messages[err.code] ?? 'Something went wrong. Please try again.';
}
