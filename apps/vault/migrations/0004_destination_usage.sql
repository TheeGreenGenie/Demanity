-- Per-destination caps on SMS codes (defense against SMS pumping / toll fraud
-- and against flooding one person's phone). The destination is stored only as
-- a keyed lookup hash, never the phone number. Rows older than two days are
-- pruned as new codes are sent.
CREATE TABLE outbound_destination_usage (
  destination  bytea       NOT NULL,
  window_kind  text        NOT NULL CHECK (window_kind IN ('hour', 'day')),
  window_start timestamptz NOT NULL,
  sent         integer     NOT NULL DEFAULT 0 CHECK (sent >= 0),
  PRIMARY KEY (destination, window_kind, window_start)
);
CREATE INDEX outbound_destination_usage_age ON outbound_destination_usage (window_start);
