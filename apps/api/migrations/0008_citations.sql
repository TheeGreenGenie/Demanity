-- Trust scoring v1 (R12, R13, R17, R33; docs/SCORING.md §2-§3): approved
-- sources, contributor grants, citations, private accuracy/approval votes,
-- and a dirty flag so scores are recomputed in periodic batches.

-- Approved citation sources (docs/SOURCES.md, REVIEW BEFORE RELEASE).
-- A URL is accepted when its host equals `domain` or ends with "." || domain.
CREATE TABLE approved_sources (
  domain     text PRIMARY KEY CHECK (domain ~ '^[a-z0-9.-]{2,253}$'),
  name       text        NOT NULL,
  tier       smallint    NOT NULL CHECK (tier IN (1, 2, 3)),
  weight     numeric     NOT NULL CHECK (weight > 0 AND weight <= 1),
  added_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO approved_sources (domain, name, tier, weight) VALUES
  -- Tier 1: primary official sources (weight 1.0). Every .gov host is a U.S.
  -- government site (the .gov registry is restricted to government bodies).
  ('gov', 'U.S. government (.gov) sites', 1, 1.0),
  ('cde.ucr.cjis.gov', 'FBI Crime Data Explorer', 1, 1.0),
  ('courtlistener.com', 'CourtListener', 1, 1.0),
  ('openstates.org', 'Open States', 1, 1.0),
  -- Tier 2: wire services, C-SPAN (weight 0.9). IFCN fact-checkers are added
  -- individually after review.
  ('apnews.com', 'Associated Press', 2, 0.9),
  ('reuters.com', 'Reuters', 2, 0.9),
  ('c-span.org', 'C-SPAN', 2, 0.9);
-- Tier 3 outlets are added only after the cross-partisan review (docs/SOURCES.md).

-- Contributors may submit citations in a category (yearly renewal).
CREATE TABLE contributor_grants (
  account_id  uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  category_id uuid        NOT NULL REFERENCES communities (id),
  expires_at  timestamptz NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, category_id)
);

CREATE TABLE citations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_id        uuid        NOT NULL REFERENCES leaders (id) ON DELETE CASCADE,
  category_id      uuid        NOT NULL REFERENCES communities (id),
  direction        text        NOT NULL CHECK (direction IN ('positive', 'negative')),
  claim            text        NOT NULL CHECK (char_length(claim) BETWEEN 10 AND 1000),
  source_url       text        NOT NULL CHECK (char_length(source_url) <= 2000),
  source_domain    text        NOT NULL REFERENCES approved_sources (domain),
  action_date      date        NOT NULL,     -- when the cited action happened (streak order)
  -- Who submitted it. Contributors' citations are shown unattributed;
  -- a leader's citations always show the leader's name (R17).
  submitted_by     uuid        REFERENCES accounts (id) ON DELETE SET NULL,
  author_leader_id uuid        REFERENCES leaders (id) ON DELETE SET NULL,
  status           text        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'rejected', 'removed')),
  -- t in docs/SCORING.md §3: the leader's category score / 100 when accepted.
  trust_at_add     numeric     CHECK (trust_at_add BETWEEN 0 AND 1),
  accepted_at      timestamptz,
  -- Anonymous vote totals (no per-account direction is stored).
  accurate_yes     integer     NOT NULL DEFAULT 0 CHECK (accurate_yes >= 0),
  accurate_no      integer     NOT NULL DEFAULT 0 CHECK (accurate_no >= 0),
  approve_yes      integer     NOT NULL DEFAULT 0 CHECK (approve_yes >= 0),
  approve_no       integer     NOT NULL DEFAULT 0 CHECK (approve_no >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Leaders can never cite themselves (R17).
  CHECK (author_leader_id IS NULL OR author_leader_id <> leader_id)
);
CREATE INDEX citations_leader_category ON citations (leader_id, category_id, action_date);
CREATE INDEX citations_pending ON citations (created_at) WHERE status = 'pending';

-- Which votes an account has cast (to allow one each), never which way.
CREATE TABLE citation_vote_markers (
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  citation_id uuid NOT NULL REFERENCES citations (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('accurate', 'approve')),
  PRIMARY KEY (account_id, citation_id, kind)
);

-- Set when scoring inputs change; the batch job recomputes and clears it.
ALTER TABLE data_version ADD COLUMN dirty boolean NOT NULL DEFAULT false;
