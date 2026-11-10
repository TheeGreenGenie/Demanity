-- Phase 3 ingestion (R23, R30): provenance on every ingested row and a
-- public data-freshness record per source. Sync jobs are idempotent: they
-- upsert on (source, external_id), so re-running never duplicates rows.

ALTER TABLE bills
  ADD COLUMN source             text,          -- e.g. 'congress.gov'; NULL for hand-entered rows
  ADD COLUMN external_id        text,          -- e.g. 'us:119:hr:1'
  ADD COLUMN latest_action_text text NOT NULL DEFAULT '',
  ADD COLUMN source_updated_at  timestamptz,   -- the source's own updateDate
  ADD COLUMN fetched_at         timestamptz,
  ADD CONSTRAINT bills_source_external UNIQUE (source, external_id);

ALTER TABLE leaders
  ADD COLUMN source      text,
  ADD COLUMN external_id text,                 -- e.g. Bioguide ID for members of Congress
  ADD CONSTRAINT leaders_source_external UNIQUE (source, external_id);

CREATE TABLE sync_state (
  source          text PRIMARY KEY,
  -- Everything updated at the source before this moment has been synced.
  synced_through  timestamptz,
  last_run_at     timestamptz,
  last_success_at timestamptz,
  last_error      text,
  items_last_run  integer NOT NULL DEFAULT 0
);
