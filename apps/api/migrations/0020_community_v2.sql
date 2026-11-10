-- Community v2: polls (R5, R7 interim), reposts (R15), feed preferences
-- (R16), and the organization page with advisory votes (R22).

-- Polls on posts. Same privacy design as bill stances: we record only that
-- an account voted (no option, no time); choices are anonymous counters.
-- Results are hidden until you vote or the poll closes.
CREATE TABLE polls (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id   uuid        NOT NULL UNIQUE REFERENCES posts (id) ON DELETE CASCADE,
  question  text        NOT NULL CHECK (char_length(question) BETWEEN 5 AND 300),
  closes_at timestamptz NOT NULL
);
CREATE TABLE poll_options (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid    NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  label   text    NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  seq     integer NOT NULL,
  votes   integer NOT NULL DEFAULT 0 CHECK (votes >= 0),
  UNIQUE (poll_id, seq)
);
CREATE TABLE poll_ballots (
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  poll_id    uuid NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, poll_id)
);

-- Reposts with an optional comment.
CREATE TABLE reposts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  target_type text        NOT NULL CHECK (target_type IN ('post', 'bill', 'leader')),
  target_id   uuid        NOT NULL,
  comment     text        NOT NULL DEFAULT '' CHECK (char_length(comment) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, target_type, target_id)
);
CREATE INDEX reposts_recent ON reposts (account_id, created_at DESC);

-- Feed preferences: mutes and what to include. Shareable as a "recipe".
CREATE TABLE feed_prefs (
  account_id        uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  muted_communities text[]  NOT NULL DEFAULT '{}',   -- community slugs
  muted_accounts    text[]  NOT NULL DEFAULT '{}',   -- usernames
  include_updates   boolean NOT NULL DEFAULT true,   -- bill updates from what you follow
  include_reposts   boolean NOT NULL DEFAULT true,
  sort              text    NOT NULL DEFAULT 'new' CHECK (sort IN ('new', 'top_day')),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Organization page (R22): Demanity's own decisions, put to members.
-- Votes are advisory; above the threshold Demanity must respond publicly.
CREATE TABLE org_proposals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text        NOT NULL CHECK (char_length(title) BETWEEN 5 AND 200),
  body       text        NOT NULL CHECK (char_length(body) BETWEEN 20 AND 6000),
  status     text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'responded', 'closed')),
  response   text,
  support    integer     NOT NULL DEFAULT 0 CHECK (support >= 0),
  oppose     integer     NOT NULL DEFAULT 0 CHECK (oppose >= 0),
  created_by uuid        REFERENCES accounts (id) ON DELETE SET NULL,   -- internal only
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE TABLE org_ballots (
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES org_proposals (id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, proposal_id)
);

ALTER TABLE context_notes DROP CONSTRAINT context_notes_target_type_check;
ALTER TABLE context_notes ADD CONSTRAINT context_notes_target_type_check
  CHECK (target_type IN ('post', 'comment', 'bill', 'citation', 'org_proposal'));
