/**
 * Typed client for the Demanity API. Only the API URL comes from the bundle
 * (EXPO_PUBLIC_ values are public by design); no secrets live in the app.
 */
import { Platform } from 'react-native';

// The web app uses an HttpOnly session cookie (apps/api/src/auth/web-session.ts),
// so in development it calls the API on the same site as the page (localhost).
const WEB = Platform.OS === 'web';
const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (WEB ? 'http://localhost:3000' : 'http://127.0.0.1:3000');
/** On web, the "token" the app holds is this marker; the real one is in the cookie. */
export const COOKIE_SESSION = 'cookie';

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
  /** Shows moderator tools; the server checks every action anyway. */
  moderator?: boolean;
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
      ...(opts.token && opts.token !== COOKIE_SESSION
        ? { authorization: `Bearer ${opts.token}` }
        : {}),
      ...(WEB ? { 'x-demanity-client': 'web' } : {}),
      ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    ...(WEB ? { credentials: 'include' as const } : {}),
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
  /** Topic auto-mapped from state subject tags (draft mapping, under review). */
  categoryAuto: boolean;
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
  /** Official photo (members of Congress) and its required credit line. */
  photoUrl: string | null;
  photoCredit: string | null;
  leftOfficeAt: string | null;
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

export type NoteTarget = 'post' | 'comment' | 'bill' | 'citation';

export interface ContextNote {
  id: string;
  body: string;
  sourceUrl: string;
  sourceName: string;
  createdAt: string;
}

export interface PendingAppeal {
  id: string;
  targetType: 'post' | 'comment' | 'context_note';
  targetId: string;
  statement: string;
  yourDecision: boolean;
}

export interface LogEntry {
  id: number;
  action: string;
  target_username: string | null;
  reason_code: string;
  actor_role: string;
  created_at: string;
}

export interface BillAction {
  date: string;
  text: string;
  type: string;
}

export interface ExecutiveOrder {
  documentNumber: string;
  number: string | null;
  title: string;
  signingDate: string | null;
  publicationDate: string;
  president: string;
  abstract: string;
  url: string;
  sourceName: string;
}

export interface Contribution {
  id: string;
  title: string;
  body: string;
  sourceUrl: string | null;
  createdAt: string;
  author: { username: string } | null;
  placeName: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  votes: number;
  myVote: boolean;
}

export interface PendingContribution {
  id: string;
  kind: 'missing_item' | 'bill_idea';
  title: string;
  body: string;
  sourceUrl: string | null;
}

export interface Stance {
  id: string;
  categorySlug: string;
  categoryName: string;
  position: 'support' | 'oppose' | 'mixed';
  statement: string;
  sourceUrl: string;
  sourceName: string;
  statedOn: string;
}

export interface CompareSide {
  leader: {
    slug: string;
    name: string;
    office: string;
    party: string;
    photoUrl: string | null;
    inOffice: boolean;
  };
  overall: Overall;
  citations: number;
  scores: Record<string, CategoryScore>;
  stances: Record<string, Stance>;
}

export interface Poll {
  id: string;
  question: string;
  closesAt: string;
  closed: boolean;
  voted: boolean;
  total: number | null;
  options: { id: string; label: string; votes: number | null }[];
  label: string;
}

export interface Repost {
  id: string;
  by: string;
  targetType: 'post' | 'bill' | 'leader';
  comment: string;
  createdAt: string;
  reason: string;
  target: Record<string, unknown>;
}

export interface FeedPrefs {
  mutedCommunities: string[];
  mutedAccounts: string[];
  includeUpdates: boolean;
  includeReposts: boolean;
  sort: 'new' | 'top_day';
  recipe: string;
}

export interface Digest {
  from: string;
  to: string;
  bills: Bill[];
  stories: { id: string; title: string; username: string | null; kudos: number }[];
  note: string;
}

export interface OrgProposal {
  id: string;
  title: string;
  body: string;
  status: 'open' | 'responded' | 'closed';
  response: string | null;
  respondedAt: string | null;
  createdAt: string;
  voted: boolean;
  tally: { support: number; oppose: number } | null;
  responseRequired: boolean;
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

export const moderation = {
  log: (before?: number) =>
    request<{ entries: LogEntry[] }>(
      'GET',
      `/v1/moderation/log${before ? `?before=${before}` : ''}`,
    ),
  reasonCodes: () => request<Record<string, unknown>>('GET', '/v1/moderation/reason-codes'),
  removePost: (token: string, id: string, reasonCode: string) =>
    request<{ status: string }>('POST', `/v1/moderation/posts/${id}/remove`, {
      token,
      body: { reasonCode },
    }),
  removeComment: (token: string, id: string, reasonCode: string) =>
    request<{ status: string }>('POST', `/v1/moderation/comments/${id}/remove`, {
      token,
      body: { reasonCode },
    }),
  addNote: (
    token: string,
    body: {
      targetType: NoteTarget;
      targetId: string;
      body: string;
      sourceUrl: string;
      reasonCode: string;
    },
  ) => request<{ id: string }>('POST', '/v1/moderation/context-notes', { token, body }),
  notes: (targetType: NoteTarget, targetId: string) =>
    request<{ notes: ContextNote[] }>(
      'GET',
      `/v1/context-notes?targetType=${targetType}&targetId=${targetId}`,
    ),
  appeal: (
    token: string,
    targetType: 'post' | 'comment' | 'context_note',
    targetId: string,
    statement: string,
  ) =>
    request<{ id: string; status: string }>('POST', '/v1/appeals', {
      token,
      body: { targetType, targetId, statement },
    }),
  pendingAppeals: (token: string) =>
    request<{ appeals: PendingAppeal[] }>('GET', '/v1/moderation/appeals', { token }),
  decideAppeal: (token: string, id: string, decision: 'uphold' | 'deny', reasonCode: string) =>
    request<{ status: string }>('POST', `/v1/moderation/appeals/${id}/decision`, {
      token,
      body: { decision, reasonCode },
    }),
  moderateRequest: (
    token: string,
    id: string,
    body: { status: 'done' | 'removed' | 'merged'; reasonCode: string; mergeInto?: string },
  ) => request<{ status: string }>('PATCH', `/v1/leader-requests/${id}`, { token, body }),
};

export const community = {
  poll: (token: string | null, postId: string) =>
    request<Poll>('GET', `/v1/posts/${postId}/poll`, { token }),
  addPoll: (token: string, postId: string, question: string, options: string[], days = 7) =>
    request<{ id: string }>('POST', `/v1/posts/${postId}/poll`, {
      token,
      body: { question, options, days },
    }),
  votePoll: (token: string, pollId: string, optionId: string) =>
    request<{ status: string }>('POST', `/v1/polls/${pollId}/vote`, { token, body: { optionId } }),
  repost: (token: string, targetType: 'post' | 'bill' | 'leader', targetId: string, comment = '') =>
    request<void>('PUT', '/v1/reposts', { token, body: { targetType, targetId, comment } }),
  unrepost: (token: string, targetType: 'post' | 'bill' | 'leader', targetId: string) =>
    request<void>('DELETE', '/v1/reposts', { token, body: { targetType, targetId } }),
  feedReposts: (token: string) =>
    request<{ reposts: Repost[] }>('GET', '/v1/feed/reposts', { token }),
  feedPrefs: (token: string) => request<FeedPrefs>('GET', '/v1/me/feed-prefs', { token }),
  saveFeedPrefs: (token: string, body: Partial<Omit<FeedPrefs, 'recipe'>> & { recipe?: string }) =>
    request<FeedPrefs>('PUT', '/v1/me/feed-prefs', { token, body }),
  digest: () => request<Digest>('GET', '/v1/digest/common-ground'),
  orgProposals: (token: string | null) =>
    request<{ threshold: number; proposals: OrgProposal[] }>('GET', '/v1/org/proposals', { token }),
  voteOrg: (token: string, id: string, stance: 'support' | 'oppose') =>
    request<{ status: string }>('POST', `/v1/org/proposals/${id}/vote`, {
      token,
      body: { stance },
    }),
  postOrg: (token: string, title: string, body: string) =>
    request<{ id: string }>('POST', '/v1/moderation/org/proposals', {
      token,
      body: { title, body },
    }),
  respondOrg: (token: string, id: string, response: string) =>
    request<{ status: string }>('POST', `/v1/moderation/org/proposals/${id}/respond`, {
      token,
      body: { response },
    }),
};

export type FactCheckLabel = 'verified' | 'context_added' | 'misleading' | 'removed';
export interface CommentFactCheck {
  id?: string;
  status: 'in_review' | 'decided';
  outcome?: FactCheckLabel;
  label?: string;
  panel?: string;
  reversed?: boolean;
  decidedAt?: string;
}
export interface FactCheckDraft {
  summary: string;
  claims: { claim: string; assessment: string; reasoning: string }[];
  suggestedLabel: FactCheckLabel;
  whereToCheck: { domain: string; what: string }[];
  injectionAttemptDetected: boolean;
}
export interface FactCheckSeat {
  id: string;
  trigger: 'flags' | 'author_request' | 'reversal';
  aiStatus: 'disabled' | 'pending' | 'done' | 'failed';
  aiDraft: FactCheckDraft | null;
  aiModel: string | null;
  comment: string;
  commentId: string;
  postId: string;
  postTitle: string;
  myVote: FactCheckLabel | null;
  votesIn: number;
  previousOutcome: FactCheckLabel | null;
}
export interface Perspective {
  id: string;
  body: string;
  sourceUrl: string;
  sourceName: string;
  helpful: number;
  votes: number;
  voted: boolean;
  mine: boolean;
  createdAt: string;
}
export interface ContributionScore {
  score: {
    score: number;
    citations: number;
    perspectives: number;
    takedowns: number;
    noted: number;
    computedAt: string;
  } | null;
  revokeBelow: number;
  formula: string;
}

export const factChecks = {
  labels: (postId: string) =>
    request<{ labels: Record<string, CommentFactCheck>; note: string }>(
      'GET',
      `/v1/posts/${postId}/fact-checks`,
    ),
  flag: (token: string, commentId: string) =>
    request<{ status: string }>('POST', `/v1/comments/${commentId}/fact-check/flag`, { token }),
  request: (token: string, commentId: string) =>
    request<{ status: string }>('POST', `/v1/comments/${commentId}/fact-check/request`, { token }),
  reversal: (token: string, id: string) =>
    request<{ status: string }>('POST', `/v1/fact-checks/${id}/reversal`, { token }),
  queue: (token: string) =>
    request<{ assigned: FactCheckSeat[]; awaitingPanel: number }>(
      'GET',
      '/v1/moderation/fact-checks',
      { token },
    ),
  vote: (token: string, id: string, vote: FactCheckLabel) =>
    request<{ status: string; outcome?: FactCheckLabel }>(
      'POST',
      `/v1/moderation/fact-checks/${id}/vote`,
      { token, body: { vote } },
    ),
  setLean: (token: string, lean: 'left' | 'center' | 'right') =>
    request<void>('PUT', '/v1/moderation/lean', { token, body: { lean } }),
  leans: () => request<{ leans: Record<string, number> }>('GET', '/v1/moderation/leans'),
};

export const perspectives = {
  list: (token: string | null, citationId: string) =>
    request<{
      citation: { claim: string; category: string; leader: string };
      intro: string;
      entries: Perspective[];
    }>('GET', `/v1/citations/${citationId}/perspectives`, { token }),
  add: (token: string, citationId: string, body: string, sourceUrl: string) =>
    request<{ id: string }>('POST', `/v1/citations/${citationId}/perspectives`, {
      token,
      body: { body, sourceUrl },
    }),
  vote: (token: string, id: string, helpful: boolean) =>
    request<{ status: string }>('POST', `/v1/perspectives/${id}/vote`, {
      token,
      body: { helpful },
    }),
  remove: (token: string, id: string, reasonCode: string) =>
    request<{ status: string }>('POST', `/v1/moderation/perspectives/${id}/remove`, {
      token,
      body: { reasonCode },
    }),
  myScore: (token: string) =>
    request<ContributionScore>('GET', '/v1/me/contribution-score', { token }),
};

export const leaders = {
  stances: (slug: string) => request<{ stances: Stance[] }>('GET', `/v1/leaders/${slug}/stances`),
  addStance: (
    token: string,
    slug: string,
    body: {
      category: string;
      position: 'support' | 'oppose' | 'mixed';
      statement: string;
      sourceUrl: string;
      statedOn: string;
    },
  ) => request<{ id: string }>('POST', `/v1/moderation/leaders/${slug}/stances`, { token, body }),
  compare: (a: string, b: string) =>
    request<{ a: CompareSide; b: CompareSide; categories: { slug: string; name: string }[] }>(
      'GET',
      `/v1/compare?a=${a}&b=${b}`,
    ),
};

export const bills = {
  timeline: (id: string) => request<{ actions: BillAction[] }>('GET', `/v1/bills/${id}/timeline`),
  posts: (token: string | null, id: string, cursor?: string | null) =>
    request<Page<Post>>('GET', `/v1/bills/${id}/posts${q(cursor)}`, { token }),
  createPost: (token: string, id: string, title: string, body: string) =>
    request<Post>('POST', `/v1/bills/${id}/posts`, { token, body: { title, body } }),
  executiveOrders: () => request<{ orders: ExecutiveOrder[] }>('GET', '/v1/executive-orders'),
  contributions: (token: string | null, kind: 'missing_item' | 'bill_idea') =>
    request<{ contributions: Contribution[] }>('GET', `/v1/contributions?kind=${kind}`, { token }),
  contribute: (
    token: string,
    body: {
      kind: 'missing_item' | 'bill_idea';
      title: string;
      body: string;
      sourceUrl?: string;
      category?: string;
    },
  ) => request<{ id: string; status: string }>('POST', '/v1/contributions', { token, body }),
  voteIdea: (token: string, id: string, on: boolean) =>
    request<void>(on ? 'PUT' : 'DELETE', `/v1/contributions/${id}/vote`, { token }),
  pendingContributions: (token: string) =>
    request<{ contributions: PendingContribution[] }>('GET', '/v1/moderation/contributions', {
      token,
    }),
  decideContribution: (
    token: string,
    id: string,
    decision: 'accept' | 'reject',
    reasonCode: string,
  ) =>
    request<{ status: string }>('POST', `/v1/moderation/contributions/${id}/decision`, {
      token,
      body: { decision, reasonCode },
    }),
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
  myContributor: (token: string) =>
    request<ContributorStatus>('GET', '/v1/me/contributor', { token }),
  pendingApplications: (token: string) =>
    request<{ applications: PendingApplication[] }>(
      'GET',
      '/v1/moderation/contributor-applications',
      {
        token,
      },
    ),
  decideApplication: (
    token: string,
    id: string,
    decision: 'approve' | 'reject',
    reasonCode: string,
  ) =>
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
    poll_closed: 'This poll has closed.',
    poll_exists: 'This post already has a poll.',
    invalid_recipe: 'That recipe code isn’t valid.',
    pick_two_different_leaders: 'Pick two different leaders to compare.',
    source_required: 'Missing items need a link to an official source.',
    slow_mode: 'This thread is busy. To keep it readable, you can comment once every 2 minutes.',
    already_appealed: 'You already appealed this.',
    only_the_author_can_appeal: 'Only the author can appeal.',
    nothing_to_appeal: 'There’s nothing to appeal here.',
    awaiting_second_moderator: 'You proposed this; a second moderator must confirm it.',
    reason_mismatch_with_proposal:
      'Another moderator proposed a different reason. Discuss before confirming.',
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
    already_weighed_in: 'You already weighed in on this bill. Stances can’t be changed.',
    leader_not_in_office: 'This leader is no longer in office.',
    already_flagged: 'You already flagged this for a fact-check.',
    use_request_for_own_comment: 'For your own comment, use “Request a fact-check”.',
    author_only: 'Only the author can request this.',
    already_reviewed: 'This has already been reviewed.',
    review_in_progress: 'A review is already in progress.',
    not_on_panel: 'You aren’t on this panel.',
    sat_on_a_panel: 'You sat on a panel for this comment, so a different moderator must ask.',
    own_citation: 'You can’t add a perspective to your own citation.',
    own_entry: 'You can’t vote on your own entry.',
    already_contributed: 'You already added a perspective to this citation.',
  };
  if (err.status === 429) return 'Too many attempts. Please wait a little and try again.';
  return messages[err.code] ?? 'Something went wrong. Please try again.';
}
