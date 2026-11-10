-- Identity vault schema (docs/PRIVACY.md, ADR 0002).
-- Holds NO names, birth dates, document numbers or political activity.

CREATE TABLE identities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_version  smallint    NOT NULL,
  token          bytea       NOT NULL,           -- HMAC of identity attributes
  status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  account_lookup bytea       UNIQUE,             -- HMAC of the pseudonymous account ID
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token_version, token)
);

CREATE TABLE contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid        NOT NULL REFERENCES identities (id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('email', 'phone')),
  lookup_hash bytea       NOT NULL UNIQUE,       -- one contact value per person
  envelope    jsonb       NOT NULL,              -- envelope-encrypted value
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_id, kind)
);

-- Append-only audit trail of vault actions. Never contains attribute values.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  action      text        NOT NULL,
  identity_id uuid,
  actor       text        NOT NULL,
  reason_code text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION audit_log_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
