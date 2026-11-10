-- Humanity "Learn" guides (R18, R29): short informational explainers that
-- help people take part in civic life. Every factual statement is backed by
-- an official source listed in `sources` (docs/SOURCES.md). Sources were
-- checked on 2026-11-10; re-check them when a guide is edited.

CREATE TABLE guides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  topic           text        NOT NULL CHECK (topic IN ('civics', 'voting', 'cost-of-living', 'community', 'media-literacy')),
  title           text        NOT NULL,
  summary         text        NOT NULL,
  body            text        NOT NULL,
  -- [{ "label": "...", "url": "https://..." }]
  sources         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  reading_minutes smallint    NOT NULL DEFAULT 2,
  is_sample       boolean     NOT NULL DEFAULT false,
  updated_at      date        NOT NULL DEFAULT CURRENT_DATE
);

INSERT INTO guides (slug, topic, title, summary, body, sources, reading_minutes, updated_at) VALUES
('how-a-bill-becomes-law', 'civics',
 'How a bill becomes a federal law',
 'From an idea to the president''s desk, in seven steps.',
 E'1. Someone proposes it. Ideas can come from a member of Congress, a campaign promise, or citizens and groups petitioning their representatives.\n\n2. A committee studies it. The bill is assigned to a committee whose members research, debate and amend it. Most bills never leave committee.\n\n3. The full chamber votes. In the House a bill passes with a simple majority (218 of 435 when every seat is filled).\n\n4. The other chamber repeats the process: committee, debate, vote. In the Senate a simple majority is 51 of 100.\n\n5. The two chambers settle their differences, often in a conference committee, and both vote on the same final version.\n\n6. The president has 10 days to sign or veto it.\n\n7. Congress can usually override a veto by vote. A "pocket veto" (the president leaves the bill unsigned after Congress adjourns) cannot be overridden.\n\nGood to know: only the House can start tax and revenue bills.',
 '[{"label":"USAGov: How laws are made","url":"https://www.usa.gov/how-laws-are-made"},{"label":"U.S. House of Representatives: The legislative process","url":"https://www.house.gov/the-house-explained/the-legislative-process"}]',
 3, '2026-11-10'),
('contact-your-officials', 'civics',
 'Find and contact your elected officials',
 'Who represents you, from the White House to city hall, and how to reach them.',
 E'You are represented at three levels, and each one handles different problems:\n\n- Federal: the president, your two U.S. senators and your U.S. representative.\n- State: your governor and your state legislators.\n- Local: your mayor, county executive and city or town council.\n\nUSAGov keeps an official directory with contact details for all three levels. A short, specific message about one issue, with your town or ZIP code, is easiest for an office to act on.\n\nOn Demanity, every leader page has a Requests tab where members vote on what they most want that leader to do.',
 '[{"label":"USAGov: Find and contact elected officials","url":"https://www.usa.gov/elected-officials"}]',
 2, '2026-11-10'),
('register-to-vote', 'voting',
 'Register to vote and check your registration',
 'Rules and deadlines differ by state. Here is where to start.',
 E'Start at vote.gov and pick your state or territory; it sends you to your state''s official instructions.\n\nDepending on your state you may register online, by mail or in person at your local election office. You can also use the National Mail Voter Registration Form, or register at a motor vehicle office or certain public assistance offices.\n\nDeadlines and required documents vary by state. Many states accept a driver''s license or state ID number. Check your state''s deadline well before an election, and confirm your registration after you move.',
 '[{"label":"USAGov: Register to vote","url":"https://www.usa.gov/register-to-vote"},{"label":"Vote.gov (official voter registration site)","url":"https://vote.gov/"}]',
 2, '2026-11-10'),
('cost-of-living-explained', 'cost-of-living',
 'What "cost of living" numbers really mean',
 'How price levels are compared between places, and what the numbers leave out.',
 E'Prices differ a lot from place to place. The U.S. Bureau of Economic Analysis measures this with Regional Price Parities (RPPs): each state or metro area gets a value as a percentage of the national price level. Above 100 means prices are higher than the national average; below 100 means lower. For example, BEA reports California at 110.7 and Arkansas at 86.9 for 2024.\n\nChildcare is one of the biggest costs for families. The U.S. Department of Labor''s National Database of Childcare Prices is the most comprehensive federal source of childcare prices at the county level.\n\nWhat these numbers leave out: averages hide differences within a place, and a low price level often comes with lower wages. That is why Demanity place pages show prices next to income and other statistics, each with its source and date.',
 '[{"label":"BEA: Regional Price Parities by State and Metro Area","url":"https://www.bea.gov/data/prices-inflation/regional-price-parities-state-and-metro-area"},{"label":"U.S. Department of Labor: National Database of Childcare Prices","url":"https://www.dol.gov/agencies/wb/topics/featured-childcare"}]',
 3, '2026-11-10'),
('reading-scores-and-polls', 'media-literacy',
 'How to read Demanity scores and results',
 'What a 0-100 score, a sample size and a "low evidence" label tell you, and what they don''t.',
 E'Scores run from 0 to 100, and higher is better. Tap any category to see why it got that score and the evidence behind it. A "low evidence" label means few sources so far; treat that score as a first impression.\n\nPlaces are only compared with the same kind of place: cities with cities, states with states, districts with districts.\n\nResults from Demanity members always show how many people took part (n). Members choose to be here, so results describe Demanity members, not all Americans.\n\nThe scoring method is published and still under public review. Anyone can read it and propose changes.',
 '[]',
 2, '2026-11-10'),
('be-a-good-neighbor', 'community',
 'Disagree well',
 'Practical habits for talking politics without losing friends.',
 E'- Ask what someone''s experience has been before arguing about policy.\n- Argue with the idea, not the person.\n- Cite sources for facts; share opinions as opinions.\n- Look for one thing you agree on before you get to what you don''t.\n- Step away from a thread when it stops being useful. You can always come back.\n\nThese are the same habits Demanity''s community rules ask of everyone.',
 '[]',
 1, '2026-11-10');
