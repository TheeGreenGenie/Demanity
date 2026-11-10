-- Marks accounts created by the development seed command (dev/seed-moderators.ts).
-- The production API refuses to start while this table has any rows, so
-- testing accounts can never reach the live app.
CREATE TABLE dev_seed_accounts (
  account_id uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
