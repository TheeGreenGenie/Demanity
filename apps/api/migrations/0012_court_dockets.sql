-- Federal case filings (RECAP dockets via CourtListener) for court-district
-- pages, plus the court's citation abbreviation (e.g. "C.D. Cal.") so every
-- case can be shown with a proper citation and a link to its source.
-- Deliberately NOT stored: party, attorney and firm lists from the search
-- results (privacy, R3). The case name is the public caption of the case.

ALTER TABLE court_rulings ADD COLUMN court_citation text NOT NULL DEFAULT '';

CREATE TABLE court_dockets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text        NOT NULL,           -- 'courtlistener'
  external_id    text        NOT NULL,           -- CourtListener docket_id
  court_id       text        NOT NULL,           -- e.g. 'cacd'
  court_citation text        NOT NULL DEFAULT '',-- e.g. 'C.D. Cal.'
  case_name      text        NOT NULL,
  docket_number  text        NOT NULL DEFAULT '',
  date_filed     date        NOT NULL,
  cause          text        NOT NULL DEFAULT '',
  nature_of_suit text        NOT NULL DEFAULT '',
  url            text        NOT NULL,           -- public CourtListener docket page
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);
CREATE INDEX court_dockets_court ON court_dockets (court_id, date_filed DESC);
