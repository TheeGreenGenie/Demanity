-- Fact-check pipeline (R25; docs/MODERATION.md §4), contribution score with
-- automatic revocation (R13; docs/SCORING.md §5), and the opt-in
-- "Does this citation offend you?" perspectives (R29; docs/MODERATION.md §6).

-- Moderators' self-declared political lean, used only to mix fact-check
-- panels. Internal: published only as an aggregate (docs/NONPARTISANSHIP.md).
CREATE TABLE moderator_leans (
  account_id uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  lean       text        NOT NULL CHECK (lean IN ('left', 'center', 'right')),
  set_at     timestamptz NOT NULL DEFAULT now()
);

-- Which members flagged a comment for fact-checking (one flag each).
CREATE TABLE fact_check_flags (
  account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  comment_id uuid        NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, comment_id)
);

-- One review of a comment. A reversal review is a new row pointing at the
-- review it re-examines; its panel shares no member with any earlier panel.
CREATE TABLE fact_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id    uuid        NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  trigger       text        NOT NULL CHECK (trigger IN ('flags', 'author_request', 'reversal')),
  reviews_id    uuid        REFERENCES fact_checks (id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'awaiting_panel'
                  CHECK (status IN ('awaiting_panel', 'in_review', 'decided')),
  -- AI first pass: a draft for panelists only, never shown to users as a verdict.
  ai_status     text        NOT NULL DEFAULT 'disabled'
                  CHECK (ai_status IN ('disabled', 'pending', 'done', 'failed')),
  ai_draft      jsonb,
  ai_model      text,
  outcome       text        CHECK (outcome IN ('verified', 'context_added', 'misleading', 'removed')),
  votes_for     smallint,   -- how many of the 3 panelists chose the outcome
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  CHECK ((trigger = 'reversal') = (reviews_id IS NOT NULL))
);
-- At most one open review per comment.
CREATE UNIQUE INDEX fact_checks_one_open ON fact_checks (comment_id) WHERE status <> 'decided';
CREATE INDEX fact_checks_comment ON fact_checks (comment_id, decided_at);

-- Panelists and their blind votes (hidden from other panelists until all vote).
CREATE TABLE fact_check_panelists (
  fact_check_id uuid        NOT NULL REFERENCES fact_checks (id) ON DELETE CASCADE,
  moderator_id  uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  vote          text        CHECK (vote IN ('verified', 'context_added', 'misleading', 'removed')),
  voted_at      timestamptz,
  PRIMARY KEY (fact_check_id, moderator_id)
);

-- Devil's-advocate entries on a citation, written by contributors in the
-- citation's category. Every entry cites an approved source (R33).
CREATE TABLE citation_perspectives (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  citation_id   uuid        NOT NULL REFERENCES citations (id) ON DELETE CASCADE,
  author_id     uuid        REFERENCES accounts (id) ON DELETE SET NULL,  -- internal only
  body          text        NOT NULL CHECK (char_length(body) BETWEEN 40 AND 1500),
  source_url    text        NOT NULL CHECK (char_length(source_url) <= 2000),
  source_domain text        NOT NULL REFERENCES approved_sources (domain),
  status        text        NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'removed')),
  removed_reason text,
  helpful_yes   integer     NOT NULL DEFAULT 0 CHECK (helpful_yes >= 0),
  helpful_no    integer     NOT NULL DEFAULT 0 CHECK (helpful_no >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX citation_perspectives_citation ON citation_perspectives (citation_id) WHERE status = 'visible';
-- One entry per contributor per citation.
CREATE UNIQUE INDEX citation_perspectives_one_each ON citation_perspectives (citation_id, author_id);

-- Which members voted on an entry, never which way.
CREATE TABLE perspective_vote_markers (
  account_id     uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  perspective_id uuid NOT NULL REFERENCES citation_perspectives (id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, perspective_id)
);

-- Contribution scores, recomputed in the batch job (docs/SCORING.md §5).
CREATE TABLE contribution_scores (
  account_id   uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  score        numeric     NOT NULL,
  citations    integer     NOT NULL,
  perspectives integer     NOT NULL,
  takedowns    integer     NOT NULL,
  noted        integer     NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now()
);

-- Context notes and appeals may now target perspectives too.
ALTER TABLE context_notes DROP CONSTRAINT context_notes_target_type_check;
ALTER TABLE context_notes ADD CONSTRAINT context_notes_target_type_check
  CHECK (target_type IN ('post', 'comment', 'bill', 'citation', 'org_proposal', 'perspective'));
