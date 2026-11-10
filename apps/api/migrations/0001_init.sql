-- Activity database: pseudonymous accounts only (docs/PRIVACY.md).
-- No names, emails, phone numbers, documents or IP addresses live here.

CREATE TABLE accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username         text        NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,30}$'),
  -- pending:  created, identity not yet verified
  -- verified: identity verified, no confirmed 2FA contact yet
  -- active:   verified + at least one confirmed 2FA contact (may interact)
  -- banned:   permanently banned
  status           text        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'verified', 'active', 'banned')),
  -- Random WebAuthn user handle; deliberately NOT the account ID.
  webauthn_user_id bytea       NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE passkeys (
  id           text PRIMARY KEY,                  -- base64url credential ID
  account_id   uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  public_key   bytea       NOT NULL,
  counter      bigint      NOT NULL DEFAULT 0,
  transports   text[]      NOT NULL DEFAULT '{}',
  device_type  text        NOT NULL,
  backed_up    boolean     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX passkeys_account_idx ON passkeys (account_id);

-- Opaque session tokens; only their SHA-256 hash is stored.
CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY,
  account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  -- onboarding: finishing sign-up; recovery: may only register a new passkey; full: everything
  scope      text        NOT NULL CHECK (scope IN ('onboarding', 'recovery', 'full')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_account_idx ON sessions (account_id);
