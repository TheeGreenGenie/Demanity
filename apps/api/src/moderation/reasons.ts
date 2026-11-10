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
  recovery: {
    approve: ['ownership_plausible'],
    deny: ['ownership_not_established', 'suspected_takeover'],
  },
} as const;

export type BanReason = (typeof REASON_CODES.ban)[number];
