-- Civic v2: category applicability, similar-size peers, precomputed rollups
-- (so score math runs once per data change, never per request), request
-- accountability, more follow targets, bill stages, and mock election ballots.

-- 1. Which policy areas apply at which level of government. A subject is
--    scored only in categories that apply to its level (mayors don't run
--    foreign policy). Reference data, editable later (docs/SCORING.md).
CREATE TABLE category_levels (
  category_id uuid NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  level       text NOT NULL CHECK (level IN ('federal', 'state', 'local', 'judicial')),
  PRIMARY KEY (category_id, level)
);

INSERT INTO category_levels (category_id, level)
SELECT id, 'federal' FROM communities WHERE kind = 'topic';

INSERT INTO category_levels (category_id, level)
SELECT id, 'state' FROM communities WHERE kind = 'topic'
   AND slug NOT IN ('congress', 'international-affairs', 'foreign-trade-and-international-finance');

INSERT INTO category_levels (category_id, level)
SELECT id, 'local' FROM communities WHERE kind = 'topic'
   AND slug NOT IN ('congress', 'international-affairs', 'foreign-trade-and-international-finance',
                    'armed-forces-and-national-security', 'immigration', 'finance-and-financial-sector');

INSERT INTO category_levels (category_id, level)
SELECT id, 'judicial' FROM communities WHERE kind = 'topic'
   AND slug IN ('law', 'crime-and-law-enforcement', 'civil-rights-and-liberties', 'immigration');

-- 2. Similar-size peers. `peer_group` is computed by the rollup job from kind
--    and population band (e.g. 'city:major'); places are compared only
--    within their peer group.
ALTER TABLE places
  ADD COLUMN population integer CHECK (population >= 0),
  ADD COLUMN peer_group text;

-- 3. Precomputed rollups (written by src/civic/rollups.ts, read by requests).
ALTER TABLE category_scores
  ADD COLUMN applicable boolean NOT NULL DEFAULT true,
  ADD COLUMN peer_rank  integer,
  ADD COLUMN peer_count integer,
  ADD COLUMN peer_avg   integer;

CREATE TABLE score_rollups (
  subject_type        text        NOT NULL CHECK (subject_type IN ('place', 'leader')),
  subject_id          uuid        NOT NULL,
  peer_group          text        NOT NULL,
  overall             integer     CHECK (overall BETWEEN 0 AND 100),
  categories_counted  integer     NOT NULL DEFAULT 0,
  categories_excluded integer     NOT NULL DEFAULT 0,
  peer_rank           integer,
  peer_count          integer,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_type, subject_id)
);
CREATE INDEX score_rollups_group ON score_rollups (peer_group, overall DESC);

ALTER TABLE place_stats
  ADD COLUMN peer_median numeric,
  ADD COLUMN peer_count  integer;

CREATE TABLE place_cost_rollups (
  place_id            uuid    PRIMARY KEY REFERENCES places (id) ON DELETE CASCADE,
  basics_monthly      integer NOT NULL,     -- see docs/LOCATIONS.md §6 for the formula
  basics_peer_median  integer,
  basics_peer_count   integer,
  real_income         integer,              -- median income adjusted by the cost-of-living index
  computed_at         timestamptz NOT NULL DEFAULT now()
);

-- Bumped after every recompute; response caches key on it.
CREATE TABLE data_version (
  id      boolean PRIMARY KEY DEFAULT true CHECK (id),
  version bigint  NOT NULL DEFAULT 1
);
INSERT INTO data_version DEFAULT VALUES;

-- 4. Request accountability.
ALTER TABLE leaders ADD COLUMN account_id uuid UNIQUE REFERENCES accounts (id) ON DELETE SET NULL;

ALTER TABLE leader_requests DROP CONSTRAINT leader_requests_status_check;
ALTER TABLE leader_requests
  ADD CONSTRAINT leader_requests_status_check
    CHECK (status IN ('open', 'acknowledged', 'responded', 'done', 'removed', 'merged')),
  ADD COLUMN response             text CHECK (char_length(response) <= 4000),
  ADD COLUMN responded_at         timestamptz,
  ADD COLUMN status_changed_at    timestamptz,
  -- When the request first reached the must-respond vote threshold.
  ADD COLUMN threshold_reached_at timestamptz,
  ADD COLUMN merged_into          uuid REFERENCES leader_requests (id);

-- 5. Follow leaders, places and bills.
ALTER TABLE follows DROP CONSTRAINT follows_target_type_check;
ALTER TABLE follows ADD CONSTRAINT follows_target_type_check
  CHECK (target_type IN ('account', 'community', 'leader', 'place', 'bill'));

-- 6. "What changes for you" on bills.
ALTER TABLE bills ADD COLUMN impact text NOT NULL DEFAULT '';

-- 7. Mock election ballots. Same privacy design as bill stances: the ballot
--    table records only that an account voted in an election (no candidate,
--    no time); choices exist only as anonymous per-candidate counters.
CREATE TABLE election_candidates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid    NOT NULL REFERENCES elections (id) ON DELETE CASCADE,
  name        text    NOT NULL,
  party       text    NOT NULL DEFAULT '',
  leader_id   uuid    REFERENCES leaders (id) ON DELETE SET NULL,
  -- Official result share after the election, for publishing our accuracy.
  actual_pct  numeric CHECK (actual_pct BETWEEN 0 AND 100),
  is_sample   boolean NOT NULL DEFAULT false
);
CREATE INDEX election_candidates_election ON election_candidates (election_id);

CREATE TABLE election_ballots (
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  election_id uuid NOT NULL REFERENCES elections (id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, election_id)
);

CREATE TABLE election_tallies (
  candidate_id uuid    PRIMARY KEY REFERENCES election_candidates (id) ON DELETE CASCADE,
  votes        integer NOT NULL DEFAULT 0 CHECK (votes >= 0)
);
