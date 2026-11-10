-- Outbound API budgets (docs/adr/0008-outbound-api-budgets.md). One row per
-- source per clock hour, counting requests we made. Shared by every process
-- that calls the provider, so restarts and parallel jobs can't overspend.
CREATE TABLE api_usage (
  source       text        NOT NULL,
  window_start timestamptz NOT NULL,
  requests     integer     NOT NULL DEFAULT 0 CHECK (requests >= 0),
  PRIMARY KEY (source, window_start)
);
