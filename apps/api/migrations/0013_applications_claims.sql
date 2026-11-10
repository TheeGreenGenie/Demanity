-- Contributor applications (R13; docs/VISION.md "Contributors") and leader
-- page claims (R17). Both are reviewed by moderators; every decision cites a
-- published reason code and goes to the public moderation log.

CREATE TABLE contributor_applications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  category_id uuid        NOT NULL REFERENCES communities (id),
  -- The essay shows command of current facts in the category (cited sources welcome).
  essay       text        NOT NULL CHECK (char_length(essay) BETWEEN 300 AND 6000),
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason_code text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
-- One open application per person per category.
CREATE UNIQUE INDEX contributor_applications_one_pending
  ON contributor_applications (account_id, category_id) WHERE status = 'pending';

CREATE TABLE leader_claims (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  leader_id   uuid        NOT NULL REFERENCES leaders (id) ON DELETE CASCADE,
  -- How moderators can confirm it is really them, e.g. an official .gov email
  -- or office phone listed on an official site. Never shown publicly.
  evidence    text        NOT NULL CHECK (char_length(evidence) BETWEEN 20 AND 2000),
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason_code text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE UNIQUE INDEX leader_claims_one_pending ON leader_claims (leader_id) WHERE status = 'pending';
