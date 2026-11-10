-- Leaders v2 (R12, R14, R17): official photos, office lifecycle, and
-- declared stances with a timeline.

ALTER TABLE leaders
  ADD COLUMN photo_url      text,
  ADD COLUMN photo_credit   text,            -- e.g. "Image courtesy of the Member" (Congress.gov)
  ADD COLUMN left_office_at timestamptz;     -- set when a leader leaves office: page read-only, scores frozen

-- What a leader has said they stand for, by policy area, each with an
-- approved source. Added by moderators (publicly logged). The history is the
-- stance timeline: a newer stance doesn't erase older ones.
CREATE TABLE leader_stances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_id   uuid        NOT NULL REFERENCES leaders (id) ON DELETE CASCADE,
  category_id uuid        NOT NULL REFERENCES communities (id),
  position    text        NOT NULL CHECK (position IN ('support', 'oppose', 'mixed')),
  statement   text        NOT NULL CHECK (char_length(statement) BETWEEN 10 AND 1000),
  source_url  text        NOT NULL,
  source_domain text      NOT NULL REFERENCES approved_sources (domain),
  stated_on   date        NOT NULL,
  added_by    uuid        REFERENCES accounts (id) ON DELETE SET NULL,  -- internal only
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leader_stances_leader ON leader_stances (leader_id, category_id, stated_on DESC);
