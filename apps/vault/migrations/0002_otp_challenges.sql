-- Vault-generated one-time codes for free email 2FA (no paid provider).
-- Codes are stored only as keyed hashes; destinations only as lookup hashes.

CREATE TABLE otp_challenges (
  destination       bytea PRIMARY KEY,               -- lookup hash of the email address
  code_hash         bytea       NOT NULL,             -- HMAC of the code; the code itself is never stored
  attempts          smallint    NOT NULL DEFAULT 0,   -- wrong guesses against the current code
  expires_at        timestamptz NOT NULL,
  sends_in_window   smallint    NOT NULL DEFAULT 1,   -- codes sent in the current window
  window_started_at timestamptz NOT NULL DEFAULT now()
);
