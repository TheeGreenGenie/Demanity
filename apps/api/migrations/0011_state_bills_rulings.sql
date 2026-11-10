-- Budgets with several windows (minute/hour/day), needed for providers
-- that enforce all three (ADR 0008), and federal court rulings
-- (CourtListener) for court-district pages (R23, R32).

ALTER TABLE api_usage ADD COLUMN window_kind text NOT NULL DEFAULT 'hour'
  CHECK (window_kind IN ('minute', 'hour', 'day'));
ALTER TABLE api_usage DROP CONSTRAINT api_usage_pkey;
ALTER TABLE api_usage ADD PRIMARY KEY (source, window_kind, window_start);

CREATE TABLE court_rulings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text        NOT NULL,           -- 'courtlistener'
  external_id  text        NOT NULL,           -- CourtListener cluster_id
  court_id     text        NOT NULL,           -- e.g. 'cacd'
  case_name    text        NOT NULL,
  docket_number text       NOT NULL DEFAULT '',
  date_filed   date        NOT NULL,
  url          text        NOT NULL,           -- public CourtListener page
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);
CREATE INDEX court_rulings_court ON court_rulings (court_id, date_filed DESC);
