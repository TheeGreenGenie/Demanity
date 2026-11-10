-- Bill pages (R23, R24): action timelines, bill discussions, executive
-- orders (Federal Register), and member contributions with moderator review.

CREATE TABLE bill_actions (
  bill_id     uuid    NOT NULL REFERENCES bills (id) ON DELETE CASCADE,
  seq         integer NOT NULL,              -- 0 = most recent
  action_date date    NOT NULL,
  text        text    NOT NULL,
  type        text    NOT NULL DEFAULT '',
  PRIMARY KEY (bill_id, seq)
);

-- A post can be the discussion of a bill.
ALTER TABLE posts ADD COLUMN bill_id uuid REFERENCES bills (id) ON DELETE SET NULL;
CREATE INDEX posts_bill ON posts (bill_id, created_at DESC) WHERE bill_id IS NOT NULL;

CREATE TABLE executive_orders (
  document_number  text PRIMARY KEY,         -- Federal Register document number
  eo_number        text,
  title            text        NOT NULL,
  signing_date     date,
  publication_date date        NOT NULL,
  president        text        NOT NULL DEFAULT '',
  abstract         text        NOT NULL DEFAULT '',
  url              text        NOT NULL,     -- federalregister.gov page
  fetched_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX executive_orders_recent ON executive_orders (signing_date DESC NULLS LAST);

-- Member contributions (R24): missing items the feeds didn't catch, and bill
-- ideas members want discussed. Moderators approve before anything is public.
CREATE TABLE contributions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        REFERENCES accounts (id) ON DELETE SET NULL,
  kind        text        NOT NULL CHECK (kind IN ('missing_item', 'bill_idea')),
  title       text        NOT NULL CHECK (char_length(title) BETWEEN 5 AND 200),
  body        text        NOT NULL CHECK (char_length(body) BETWEEN 20 AND 4000),
  source_url  text,                           -- required for missing items
  place_id    uuid        REFERENCES places (id),
  category_id uuid        REFERENCES communities (id),
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  reason_code text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX contributions_public ON contributions (kind, created_at DESC) WHERE status = 'accepted';

CREATE TABLE contribution_votes (
  account_id      uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  contribution_id uuid NOT NULL REFERENCES contributions (id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, contribution_id)
);
