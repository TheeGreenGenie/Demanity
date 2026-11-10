-- Social core (R5, R8, R15, R16, R18): communities, posts, threaded comments,
-- reactions and follows. Content belongs to pseudonymous accounts only.

CREATE TABLE communities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,60}$'),
  name        text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  -- humanity: kudos-only, no dislikes (R18)
  kind        text        NOT NULL CHECK (kind IN ('topic', 'location', 'humanity')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE posts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid        NOT NULL REFERENCES communities (id),
  author_id    uuid        REFERENCES accounts (id) ON DELETE SET NULL,
  title        text        NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  body         text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  status       text        NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'removed')),
  removed_reason text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_community_recent ON posts (community_id, created_at DESC, id DESC);
CREATE INDEX posts_author_recent ON posts (author_id, created_at DESC, id DESC);
CREATE INDEX posts_recent ON posts (created_at DESC, id DESC);

CREATE TABLE comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid        NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  parent_id  uuid        REFERENCES comments (id) ON DELETE CASCADE,
  author_id  uuid        REFERENCES accounts (id) ON DELETE SET NULL,
  body       text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  status     text        NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_post ON comments (post_id, created_at);

CREATE TABLE reactions (
  account_id  uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  target_type text        NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id   uuid        NOT NULL,
  kind        text        NOT NULL CHECK (kind IN ('like', 'dislike', 'kudos')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, target_type, target_id)
);
CREATE INDEX reactions_target ON reactions (target_type, target_id);

CREATE TABLE follows (
  follower_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  target_type text        NOT NULL CHECK (target_type IN ('account', 'community')),
  target_id   uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, target_type, target_id)
);
CREATE INDEX follows_target ON follows (target_type, target_id);

-- Reference data (not test data): the 32 Congress.gov policy areas as topic
-- communities (docs/SCORING.md §1), the MVP locations, and Humanity.
INSERT INTO communities (slug, name, kind, description) VALUES
  ('agriculture-and-food', 'Agriculture & Food', 'topic', ''),
  ('animals', 'Animals', 'topic', ''),
  ('armed-forces-and-national-security', 'Armed Forces & National Security', 'topic', ''),
  ('arts-culture-religion', 'Arts, Culture, Religion', 'topic', ''),
  ('civil-rights-and-liberties', 'Civil Rights & Liberties, Minority Issues', 'topic', ''),
  ('commerce', 'Commerce', 'topic', ''),
  ('congress', 'Congress', 'topic', ''),
  ('crime-and-law-enforcement', 'Crime & Law Enforcement', 'topic', ''),
  ('economics-and-public-finance', 'Economics & Public Finance', 'topic', ''),
  ('education', 'Education', 'topic', ''),
  ('emergency-management', 'Emergency Management', 'topic', ''),
  ('energy', 'Energy', 'topic', ''),
  ('environmental-protection', 'Environmental Protection', 'topic', ''),
  ('families', 'Families', 'topic', ''),
  ('finance-and-financial-sector', 'Finance & Financial Sector', 'topic', ''),
  ('foreign-trade-and-international-finance', 'Foreign Trade & International Finance', 'topic', ''),
  ('government-operations-and-politics', 'Government Operations & Politics', 'topic', ''),
  ('health', 'Health', 'topic', ''),
  ('housing-and-community-development', 'Housing & Community Development', 'topic', ''),
  ('immigration', 'Immigration', 'topic', ''),
  ('international-affairs', 'International Affairs', 'topic', ''),
  ('labor-and-employment', 'Labor & Employment', 'topic', ''),
  ('law', 'Law', 'topic', ''),
  ('native-americans', 'Native Americans', 'topic', ''),
  ('public-lands-and-natural-resources', 'Public Lands & Natural Resources', 'topic', ''),
  ('science-technology-communications', 'Science, Technology, Communications', 'topic', ''),
  ('social-sciences-and-history', 'Social Sciences & History', 'topic', ''),
  ('social-welfare', 'Social Welfare', 'topic', ''),
  ('sports-and-recreation', 'Sports & Recreation', 'topic', ''),
  ('taxation', 'Taxation', 'topic', ''),
  ('transportation-and-public-works', 'Transportation & Public Works', 'topic', ''),
  ('water-resources-development', 'Water Resources Development', 'topic', ''),
  ('united-states', 'United States', 'location', 'National conversation.'),
  ('california', 'California', 'location', ''),
  ('texas', 'Texas', 'location', ''),
  ('florida', 'Florida', 'location', ''),
  ('new-york', 'New York', 'location', ''),
  ('pennsylvania', 'Pennsylvania', 'location', ''),
  ('humanity', 'Humanity', 'humanity',
   'The good people do for each other, democracy working, and the ways we are alike. Kudos only, no dislikes.');
