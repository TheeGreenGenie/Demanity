/**
 * Published reason codes (docs/MODERATION.md). Every moderation action must
 * cite one, and the code appears in the public moderation log.
 */
export const REASON_CODES = {
  verification: {
    approve: ['manual_document_review'],
    deny: ['document_unreadable', 'document_not_us', 'suspected_fraud', 'duplicate_suspected'],
  },
  ban: [
    'account_sale',
    'coordinated_inauthentic_behavior',
    'identity_fraud',
    'poll_manipulation',
    'hate_speech',
    'harassment',
    'spam',
    'other_policy_violation',
  ],
  // Content is removed only for these (docs/MODERATION.md §1); everything else gets context.
  content: [
    'clear_misinformation',
    'hate_speech',
    'harassment',
    'spam',
    'doxxing',
    'other_policy_violation',
  ],
  // Leader requests (docs/LEGISLATION.md �3b).
  request: [
    'leader_action_documented',
    'duplicate_request',
    'not_a_request',
    'other_policy_violation',
  ],
  // Citations (docs/SOURCES.md, docs/SCORING.md).
  citation: {
    accept: ['source_verified'],
    reject: [
      'source_does_not_support_claim',
      'not_an_approved_source',
      'duplicate_citation',
      'wrong_category',
      'other_policy_violation',
    ],
  },
  // Contributor status: granted after an essay review, revoked for cause.
  contributor: ['essay_approved', 'contribution_score_low', 'other_policy_violation'],
  // Contributor applications (essay review).
  contributorApplication: {
    approve: ['essay_approved'],
    reject: ['essay_insufficient', 'essay_not_original', 'other_policy_violation'],
  },
  // Leader page claims.
  leaderClaim: {
    approve: ['identity_confirmed_official_channel'],
    reject: ['identity_not_confirmed', 'not_the_officeholder', 'other_policy_violation'],
  },
  // Context notes (instead of removal).
  contextNote: ['missing_context', 'misleading_claim', 'outdated_information'],
  // Appeals, decided by a different moderator.
  appeal: {
    uphold: ['removal_not_justified', 'note_not_supported'],
    deny: ['removal_justified', 'note_supported'],
  },
  recovery: {
    approve: ['ownership_plausible'],
    deny: ['ownership_not_established', 'suspected_takeover'],
  },
} as const;

export type BanReason = (typeof REASON_CODES.ban)[number];
