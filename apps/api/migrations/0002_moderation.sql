-- Moderation (R10, R26, R28). No identity data is stored here.

-- Roles are granted only by an operator script (scripts/grant-moderator.mjs), never self-service.
CREATE TABLE account_roles (
  account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('moderator')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, role)
);

-- Public, append-only moderation log. The public API exposes every column
-- EXCEPT actor_account_id, which exists only for internal audits/appeals.
CREATE TABLE moderation_log (
  id               bigserial PRIMARY KEY,
  action           text        NOT NULL,
  target_username  text,                       -- set only for public actions such as bans
  reason_code      text        NOT NULL,
  actor_role       text        NOT NULL,
  actor_account_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION moderation_log_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'moderation_log is append-only';
END;
$$;

CREATE TRIGGER moderation_log_no_update_delete
  BEFORE UPDATE OR DELETE ON moderation_log
  FOR EACH ROW EXECUTE FUNCTION moderation_log_is_append_only();

-- Verifications the provider could not decide. Holds NO identity data: after
-- approval the user re-submits their details and the vault skips only the
-- provider check (duplicate, ban and 18+ checks still apply).
CREATE TABLE verification_reviews (
  account_id  uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'used')),
  reason_code text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);

-- Recovery when both the device and 2FA are lost: a moderator approves, then
-- the user re-verifies and must match the identity already on the account.
CREATE TABLE recovery_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'used')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE UNIQUE INDEX recovery_one_open_request ON recovery_requests (account_id)
  WHERE status IN ('pending', 'approved');
