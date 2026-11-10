-- Moderation tools (R10, R29, R33): context notes, comment removal, appeals.

-- Who removed content (internal, for appeals: a different moderator decides).
ALTER TABLE posts ADD COLUMN removed_by uuid REFERENCES accounts (id) ON DELETE SET NULL;
ALTER TABLE comments
  ADD COLUMN removed_reason text,
  ADD COLUMN removed_by     uuid REFERENCES accounts (id) ON DELETE SET NULL;

-- Context notes: labeled, sourced explanations added by moderators instead of
-- removal (docs/MODERATION.md). Every note cites an approved source.
CREATE TABLE context_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type   text        NOT NULL CHECK (target_type IN ('post', 'comment', 'bill', 'citation')),
  target_id     uuid        NOT NULL,
  body          text        NOT NULL CHECK (char_length(body) BETWEEN 10 AND 1000),
  source_url    text        NOT NULL,
  source_domain text        NOT NULL REFERENCES approved_sources (domain),
  author_id     uuid        REFERENCES accounts (id) ON DELETE SET NULL,  -- internal only
  status        text        NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'withdrawn')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX context_notes_target ON context_notes (target_type, target_id) WHERE status = 'visible';

-- Appeals by the affected author; decided by a moderator other than the one
-- who acted. Upheld appeals restore the content / withdraw the note.
CREATE TABLE appeals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  target_type text        NOT NULL CHECK (target_type IN ('post', 'comment', 'context_note')),
  target_id   uuid        NOT NULL,
  statement   text        NOT NULL CHECK (char_length(statement) BETWEEN 20 AND 2000),
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'denied')),
  reason_code text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE UNIQUE INDEX appeals_one_per_target ON appeals (target_type, target_id);
