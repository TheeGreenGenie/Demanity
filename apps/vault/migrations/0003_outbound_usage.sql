-- Global caps on outbound messages (email, SMS), so the whole service stays
-- inside provider quotas no matter how many different addresses ask for
-- codes. Counts only; no addresses or contents are stored here.
CREATE TABLE outbound_usage (
  provider     text        NOT NULL,                 -- 'email' | 'sms'
  window_kind  text        NOT NULL CHECK (window_kind IN ('hour', 'day')),
  window_start timestamptz NOT NULL,
  sent         integer     NOT NULL DEFAULT 0 CHECK (sent >= 0),
  PRIMARY KEY (provider, window_kind, window_start)
);
