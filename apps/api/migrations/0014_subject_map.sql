-- State bill subjects → CRS policy areas (R13). DRAFT, REVIEW BEFORE RELEASE
-- (docs/LEGISLATION.md). States tag bills with their own subject terms; this
-- keyword table maps them to our 32 topics. A bill gets a topic only when its
-- subjects point to one topic more than any other (ties → no topic), and the
-- raw subjects are kept so every mapping can be audited.

ALTER TABLE bills
  ADD COLUMN subjects      text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN category_auto boolean NOT NULL DEFAULT false;  -- topic came from this table

CREATE TABLE subject_category_map (
  keyword       text PRIMARY KEY CHECK (keyword = lower(keyword) AND char_length(keyword) >= 3),
  category_slug text NOT NULL,
  note          text NOT NULL DEFAULT ''
);

INSERT INTO subject_category_map (keyword, category_slug) VALUES
  ('agricultur', 'agriculture-and-food'), ('farm', 'agriculture-and-food'), ('food', 'agriculture-and-food'),
  ('animal', 'animals'),
  ('military', 'armed-forces-and-national-security'), ('veteran', 'armed-forces-and-national-security'),
  ('national guard', 'armed-forces-and-national-security'),
  ('arts', 'arts-culture-religion'), ('religio', 'arts-culture-religion'),
  ('civil rights', 'civil-rights-and-liberties'), ('discrimination', 'civil-rights-and-liberties'),
  ('commerce', 'commerce'), ('business', 'commerce'), ('consumer protection', 'commerce'),
  ('crime', 'crime-and-law-enforcement'), ('criminal', 'crime-and-law-enforcement'),
  ('law enforcement', 'crime-and-law-enforcement'), ('police', 'crime-and-law-enforcement'),
  ('corrections', 'crime-and-law-enforcement'), ('firearm', 'crime-and-law-enforcement'),
  ('budget', 'economics-and-public-finance'), ('appropriation', 'economics-and-public-finance'),
  ('education', 'education'), ('school', 'education'),
  ('emergency', 'emergency-management'), ('disaster', 'emergency-management'),
  ('energy', 'energy'), ('utilit', 'energy'),
  ('environment', 'environmental-protection'), ('pollution', 'environmental-protection'),
  ('climate', 'environmental-protection'),
  ('famil', 'families'), ('child', 'families'), ('domestic relations', 'families'),
  ('banking', 'finance-and-financial-sector'), ('financial institution', 'finance-and-financial-sector'),
  ('insurance', 'finance-and-financial-sector'),
  ('election', 'government-operations-and-politics'), ('state government', 'government-operations-and-politics'),
  ('legislature', 'government-operations-and-politics'), ('ethics', 'government-operations-and-politics'),
  ('state agenc', 'government-operations-and-politics'),
  ('health', 'health'), ('medicaid', 'health'), ('medical', 'health'),
  ('housing', 'housing-and-community-development'), ('real estate', 'housing-and-community-development'),
  ('land use', 'housing-and-community-development'), ('zoning', 'housing-and-community-development'),
  ('immigra', 'immigration'),
  ('labor', 'labor-and-employment'), ('employment', 'labor-and-employment'),
  ('workforce', 'labor-and-employment'), ('wage', 'labor-and-employment'),
  ('courts', 'law'), ('judiciary', 'law'), ('civil procedure', 'law'),
  ('tribal', 'native-americans'), ('native american', 'native-americans'), ('indian affairs', 'native-americans'),
  ('natural resource', 'public-lands-and-natural-resources'), ('parks', 'public-lands-and-natural-resources'),
  ('wildlife', 'public-lands-and-natural-resources'), ('public lands', 'public-lands-and-natural-resources'),
  ('technolog', 'science-technology-communications'), ('telecommunication', 'science-technology-communications'),
  ('broadband', 'science-technology-communications'), ('internet', 'science-technology-communications'),
  ('history', 'social-sciences-and-history'), ('memorial', 'social-sciences-and-history'),
  ('welfare', 'social-welfare'), ('social services', 'social-welfare'), ('public assistance', 'social-welfare'),
  ('sport', 'sports-and-recreation'), ('recreation', 'sports-and-recreation'), ('gaming', 'sports-and-recreation'),
  ('tax', 'taxation'),
  ('transportation', 'transportation-and-public-works'), ('motor vehicle', 'transportation-and-public-works'),
  ('highway', 'transportation-and-public-works'), ('transit', 'transportation-and-public-works'),
  ('water', 'water-resources-development');
