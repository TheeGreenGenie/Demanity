-- Two-moderator rule (R10): bans and verification denials take effect only
-- when a second, different moderator confirms the first one's proposal with
-- the same published reason. Proposals expire after 7 days.
CREATE TABLE moderation_proposals (
  kind        text        NOT NULL CHECK (kind IN ('ban', 'verification_deny')),
  target_id   uuid        NOT NULL,
  reason_code text        NOT NULL,
  proposed_by uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, target_id)
);
