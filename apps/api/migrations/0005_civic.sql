-- Civic data (R12, R13, R17, R23, R32): places, leaders, 0-100 category
-- scores with explanations, quality-of-life statistics, pressing issues,
-- elections, bills, private bill stances ("swipes") and leader requests.
--
-- Every table that can hold illustrative data has an `is_sample` flag. The
-- production API refuses to start while any sample row exists (see
-- src/dev-seed-guard.ts), so made-up numbers can never reach the live app.
-- Real rows are loaded by the Phase 3/4 ingestion jobs with real sources.

CREATE TABLE places (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  name         text        NOT NULL,
  -- Peers are compared only within the same kind (cities vs cities, ...).
  kind         text        NOT NULL CHECK (kind IN
                 ('nation', 'state', 'county', 'city', 'court_district', 'congressional_district')),
  parent_id    uuid        REFERENCES places (id),
  community_id uuid        UNIQUE REFERENCES communities (id),
  is_sample    boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX places_kind ON places (kind, name);
CREATE INDEX places_parent ON places (parent_id);

CREATE TABLE leaders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  name        text        NOT NULL,
  office      text        NOT NULL,           -- display, e.g. "U.S. Senator"
  -- Peers for score comparison: leaders holding the same kind of office.
  office_kind text        NOT NULL CHECK (office_kind IN
                ('president', 'us_senate', 'us_house', 'governor', 'state_senate', 'state_house', 'mayor', 'county_executive')),
  party       text        NOT NULL DEFAULT '',
  place_id    uuid        REFERENCES places (id),
  in_office   boolean     NOT NULL DEFAULT true,
  bio         text        NOT NULL DEFAULT '',
  is_sample   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leaders_place ON leaders (place_id);

-- One 0-100 score per subject per policy area (the 32 topic communities),
-- with the reasoning and the evidence behind it. Higher is better.
CREATE TABLE category_scores (
  subject_type   text        NOT NULL CHECK (subject_type IN ('place', 'leader')),
  subject_id     uuid        NOT NULL,
  category_id    uuid        NOT NULL REFERENCES communities (id),
  score          smallint    NOT NULL CHECK (score BETWEEN 0 AND 100),
  rationale      text        NOT NULL,
  -- [{ "label": "...", "url": "https://..." | null }]
  evidence       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  evidence_count integer     NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  method_version text        NOT NULL,
  as_of          date        NOT NULL,
  is_sample      boolean     NOT NULL DEFAULT false,
  PRIMARY KEY (subject_type, subject_id, category_id)
);
CREATE INDEX category_scores_peer ON category_scores (subject_type, category_id, score DESC);

-- Quality-of-life statistics (cost of living, groceries, rent, ...).
CREATE TABLE place_stats (
  place_id      uuid        NOT NULL REFERENCES places (id) ON DELETE CASCADE,
  key           text        NOT NULL CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  label         text        NOT NULL,
  value         numeric     NOT NULL,
  unit          text        NOT NULL CHECK (unit IN ('usd', 'usd_month', 'usd_year', 'percent', 'index', 'minutes')),
  -- Whether a higher value is better for residents (drives the comparison color).
  higher_is_better boolean  NOT NULL,
  source_label  text        NOT NULL,
  source_url    text,
  as_of         date        NOT NULL,
  is_sample     boolean     NOT NULL DEFAULT false,
  PRIMARY KEY (place_id, key)
);

CREATE TABLE place_issues (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id     uuid        NOT NULL REFERENCES places (id) ON DELETE CASCADE,
  rank         smallint    NOT NULL CHECK (rank BETWEEN 1 AND 10),
  category_id  uuid        REFERENCES communities (id),
  title        text        NOT NULL,
  summary      text        NOT NULL,
  source_label text        NOT NULL,
  source_url   text,
  is_sample    boolean     NOT NULL DEFAULT false,
  UNIQUE (place_id, rank)
);

CREATE TABLE elections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id      uuid        NOT NULL REFERENCES places (id) ON DELETE CASCADE,
  office        text        NOT NULL,
  kind          text        NOT NULL CHECK (kind IN ('general', 'primary', 'special', 'runoff')),
  election_date date        NOT NULL,
  source_label  text        NOT NULL,
  source_url    text,
  is_sample     boolean     NOT NULL DEFAULT false
);
CREATE INDEX elections_place ON elections (place_id, election_date);

CREATE TABLE bills (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id       uuid        NOT NULL REFERENCES places (id),   -- jurisdiction
  number         text        NOT NULL,                          -- e.g. "H.R. 1234"
  title          text        NOT NULL,
  summary        text        NOT NULL,
  category_id    uuid        REFERENCES communities (id),
  status         text        NOT NULL CHECK (status IN
                   ('introduced', 'in_committee', 'passed_chamber', 'passed', 'signed', 'vetoed', 'failed')),
  introduced_at  date        NOT NULL,
  last_action_at date        NOT NULL,
  source_url     text,
  is_sample      boolean     NOT NULL DEFAULT false,
  UNIQUE (place_id, number)
);
CREATE INDEX bills_recent ON bills (last_action_at DESC, id DESC);
CREATE INDEX bills_category ON bills (category_id, last_action_at DESC);

CREATE TABLE bill_sponsors (
  bill_id   uuid NOT NULL REFERENCES bills (id) ON DELETE CASCADE,
  leader_id uuid NOT NULL REFERENCES leaders (id) ON DELETE CASCADE,
  role      text NOT NULL CHECK (role IN ('sponsor', 'cosponsor')),
  PRIMARY KEY (bill_id, leader_id)
);
CREATE INDEX bill_sponsors_leader ON bill_sponsors (leader_id);

-- Bill stances ("swipe to support or oppose"). Privacy by design (R3):
-- `bill_swipes` records only THAT an account weighed in (so it isn't asked
-- twice) - not which way, and with no timestamp. The direction exists only as
-- an anonymous counter in `bill_tallies`, updated in the same transaction.
-- A database leak therefore cannot reveal how any person feels about a bill.
-- There is deliberately no code path to change a stance. Interim design until
-- unlinkable ballots (docs/EXPERIMENTS.md idea 1).
CREATE TABLE bill_swipes (
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  bill_id    uuid NOT NULL REFERENCES bills (id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, bill_id)
);

CREATE TABLE bill_tallies (
  bill_id uuid    PRIMARY KEY REFERENCES bills (id) ON DELETE CASCADE,
  support integer NOT NULL DEFAULT 0 CHECK (support >= 0),
  oppose  integer NOT NULL DEFAULT 0 CHECK (oppose >= 0)
);

-- Requests: things members most want a leader to do, upvoted by members.
CREATE TABLE leader_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_id  uuid        NOT NULL REFERENCES leaders (id) ON DELETE CASCADE,
  author_id  uuid        REFERENCES accounts (id) ON DELETE SET NULL,
  title      text        NOT NULL CHECK (char_length(title) BETWEEN 5 AND 140),
  body       text        NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  status     text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leader_requests_leader ON leader_requests (leader_id, created_at DESC);

CREATE TABLE leader_request_votes (
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES leader_requests (id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, request_id)
);
CREATE INDEX leader_request_votes_request ON leader_request_votes (request_id);

-- Reference data: the nation and the five MVP states, linked to their
-- location communities. Geography only, no figures.
INSERT INTO places (slug, name, kind, community_id)
SELECT c.slug, c.name, CASE c.slug WHEN 'united-states' THEN 'nation' ELSE 'state' END, c.id
  FROM communities c WHERE c.kind = 'location';
UPDATE places SET parent_id = (SELECT id FROM places WHERE slug = 'united-states')
 WHERE kind = 'state';
