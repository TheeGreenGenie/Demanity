# Legislation Tracker (R23, R24)

Demanity is a **government accountability** app. It tracks every new government action at the levels it covers.

## 1. Sources at the MVP stage (federal plus CA, TX, FL, NY, PA)
| Item | Source | Notes |
|---|---|---|
| Federal bills, resolutions, actions, sponsors, CRS policy area | [Congress.gov API](https://api.congress.gov/) | Free API key |
| Federal roll-call votes | Congress.gov API; [House Clerk](https://clerk.house.gov/); [Senate](https://www.senate.gov/) | |
| State bills and votes | [Open States API v3](https://v3.openstates.org/) | Coverage varies by state |
| Presidential executive orders, proclamations, federal rules | [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1) | |
| Federal regulations and dockets | [Regulations.gov API](https://open.gsa.gov/api/regulationsgov/) | API key |
| Governor executive orders | Per-state official sites | No national API; patchy, so user submissions fill the gaps |
| Court rulings | [CourtListener API](https://www.courtlistener.com/help/api/) | Includes federal district courts |
| Candidates (federal) | [OpenFEC API](https://api.open.fec.gov/developers/) | Candidate filings |
| Candidates (state) | State election offices | Patchy; community-submitted with moderator approval |

## 2. Pipeline
1. **Scheduled sync jobs** (BullMQ) run hourly or daily, depending on the source's limits.
   - Every job is **idempotent**: it upserts records by source ID.
   - Every record stores **provenance**: source URL, fetch time and source version.
2. **Normalization** maps every item to a common model: `Action { kind, jurisdiction, title, status, timeline[], policy_area, people[], source }`.
3. **Leader linking** connects each action to the leader pages of its sponsors, cosponsors, voters, signers and judges.
4. **Auto-proposed citations** ([EXPERIMENTS.md](EXPERIMENTS.md) #5):
   - When a recorded vote or signature falls in a policy area where the leader has declared a stance, the system drafts a citation.
   - The draft is positive if the action matches the declared stance and negative if it contradicts it.
   - **Only moderators can approve or delete these drafts.** Contributors cannot.
5. **Contributor feed:** each category's contributor chat receives new items in its policy area.
6. **A public data-freshness indicator** shows the last successful sync for each source.

### What is implemented today (Congress.gov)
- **Source:** the official Congress.gov API (`https://api.congress.gov/v3`), with a free api.data.gov key (`DATA_GOV_API_KEY`). Limits per the official docs: 5,000 requests per hour, at most 250 results per page.
- **Schedule:** when a key is configured, the API server syncs hourly. It can also be run by hand: `pnpm --filter @demanity/api ingest:congress [--days N] [--max N]`.
- **Incremental and idempotent:**
  - Each run asks for bills updated since the last fully synced moment, oldest first.
  - Records are upserted by `(source, external_id)`, e.g. `us:119:hr:1`, so re-running never duplicates anything.
  - The cursor advances only after a successful run. A capped run resumes from the last bill it processed.
- **Provenance on every bill:** the public Congress.gov page URL, the source's own update time, the fetch time and the latest action text.
- **Sponsors** become leader records, keyed by their Bioguide ID. They have no scores until citations about them are accepted.
- **Category** comes from the Congress.gov policy area. "Economics and Public Finance" is matched to "Economics & Public Finance".
- **Status** is inferred from the latest action text, checked in this order (first match wins):
  - "Became Public Law" or "signed by President" → signed;
  - "Vetoed" → vetoed;
  - "Failed of passage" or "not agreed to" → failed;
  - "Presented to President" or "cleared for White House" → passed;
  - "Passed House/Senate" or "agreed to in" → passed one chamber;
  - "Referred to", "committee", "reported by" or "placed on calendar" → in committee;
  - anything else, such as "Held at the desk" → introduced.

  This is a heuristic. Pulling the full action history to determine status is a planned improvement.
- **Not yet:** roll-call votes, cosponsors, summaries (Congress.gov publishes CRS summaries separately) and executive orders.

### Bill pages, executive orders and member contributions, implemented
- **Timeline and summary:** each Congress.gov bill also syncs its action history (`/actions`, up to 50, newest first) and its latest CRS summary (`/summaries`, converted from HTML to plain text). That is 2 more requests per bill, inside the same budget. A run that hits the budget mid-bill keeps the bill and fills these in on the next run.
- **Discussion:** every bill page has a discussion. New posts are filed in the bill's topic community, or the state's community, or Government Operations & Politics, and are linked to the bill.
- **Executive orders:** Federal Register API (no key), one request per run, newest 20 executive orders, each linked to its official document. The documentation site blocks automated readers, so the response shape was confirmed with a live request on 2026-11-10.
- **Member contributions (R24):** "bill ideas" and "missing legislation". Missing items must link an approved source. Nothing is public until a moderator accepts it with a published reason. Members upvote bill ideas, one vote each.

### State bills (Open States), implemented
- **Source:** Open States API v3, `GET /bills` with the key in the `X-API-KEY` header, `include=sponsorships&include=abstracts`, `sort=updated_asc`, `updated_since`, and at most 20 results per page. These details were checked in Open States' docs and open-source server.
- **Coverage:** the 5 MVP states. Each state has its own cursor (`openstates:<state>`), and runs are idempotent upserts keyed by the Open States bill ID.
- **What is stored:**
  - the identifier and session (e.g. "AB 12 (20252026)");
  - the title;
  - the first abstract, as the summary;
  - a status inferred from the latest action, using the same rules as federal bills plus state wording ("Chaptered", "Signed/Approved by the Governor", "Presented to the Governor", "Enrolled");
  - the Open States page URL;
  - up to 3 sponsors, as state-legislator leader records.
- **Category (draft, REVIEW BEFORE RELEASE):** states tag bills with their own subject terms, which Open States passes through. A keyword table (`subject_category_map`, in migrations 0014 and 0015) maps them to our 32 topics.
  - Each tag votes for every topic whose keyword it contains. Matching compares letters only, because California sends tags with the spaces removed ("Stategovernment").
  - A bill gets a topic only when one topic is strictly ahead. Ties or no matches leave it without a topic. Titles are never used.
  - The raw tags are stored on each bill so every mapping can be audited.
  - Auto-mapped topics are labeled in the app as "auto-mapped from state tags (under review)". Hand-set topics are never overwritten.
  - Edits to the table take effect at the next recompute, with no re-fetching.
  - **Live check (2026-11-10):** 15 of 20 tagged California bills mapped. One wrong mapping ("tribal colleges" → Native Americans) was fixed by adding education keywords.
  - **New York and Pennsylvania bills arrived with no subject tags,** so they have no topic until another source or a manual review supplies one.
  - **Before release:** cross-partisan review of the keyword table ([NONPARTISANSHIP.md](NONPARTISANSHIP.md)).
- **Command:** `pnpm --filter @demanity/api ingest:states`.

### Court opinions (CourtListener), implemented with a coverage caveat
- **Source:** CourtListener REST v4 search, `type=o`, `q=court_id:<id>`, `order_by=dateFiled desc` (a value from CourtListener's own `OPINION_ORDER_BY_CHOICES`). The `Authorization: Token …` header is used.
- **Courts:** the 5 federal district courts that have MVP court-district pages: `cacd`, `txsd`, `flsd`, `nyed` and `paed`.
- **Coverage caveat (live check, 2026-11-10):** the newest published opinion CourtListener has for each of these courts is from mid-2019. Court-district pages therefore show the *latest available* opinions with their dates, under a coverage note, and never call them "recent". Recent district-court activity would need CourtListener's RECAP docket data, which is a separate, later integration.
- **Command:** `pnpm --filter @demanity/api ingest:courts`.
- **Freshness:** `GET /v1/data-freshness` reports, for each source, the moment it is synced through, the last success time, and whether the last run failed.

## 3. Item pages
Each item page includes:
- a plain-language summary
- a status timeline
- a forum thread
- a verified poll ("Do you support this?")
- links to the leader pages of everyone involved
- **verified opinion compared with legislator votes**
- follow and alert controls
- context notes

## 3a. Support or oppose (swipe)
Members can weigh in on bills from a card deck: swipe right to support, left to oppose, or use the buttons.
- **One stance per member per bill, and it can't be changed.** No code path edits a stance.
- **Private by design.** The database records only *that* a member weighed in (so the bill isn't shown again), not which way, and with no timestamp. The direction exists only as an anonymous running total for the bill. A database leak therefore can't reveal how any person feels about a bill.
- **Results after you weigh in.** Totals are hidden until you've weighed in, to avoid bandwagon effects. They always show n and the self-selected-sample label.
- **Your own choices stay on your device.** Because the server can't know which way you swiped, the app remembers your stance only on your device (secure storage on phones, local storage in the browser). That lets a bill page say "You supported". Nothing is sent anywhere.
- **Stages.** Every bill is labeled with one of three stages:
  - **Proposed:** introduced, not yet acted on.
  - **Being voted on:** in committee, passed one chamber, or passed and awaiting signature.
  - **Decided:** signed, vetoed or failed.
- **A personal, filterable deck.** Bills you are most likely to care about come first: bills you follow, bills sponsored by leaders you follow, bills in places you follow, then bills in topics you follow. Each card says why it is there. After those come bills being voted on, then proposed, then decided. You can filter by level (federal or state), by state, by stage and by topic.
- **"What changes for you".** Each bill carries a one-line, plain-language description of its effect on people.
- This is an interim design until unlinkable ballots ([EXPERIMENTS.md](EXPERIMENTS.md), idea 1) replace it.

## 3b. Leader requests and the accountability loop
Each leader page has a Requests tab where members post what they most want that leader to do and upvote others' requests, one vote per member. Requests are public posts, like forum posts, and they are sorted by votes.
- **Status:** Open → Acknowledged → Responded → Done.
  - The leader, once they have claimed their page, can acknowledge a request, respond to it in writing, or mark it done.
  - Moderators can mark a request done when the action is documented, remove it, or merge duplicates.
  - Every moderator action cites a published reason code and appears in the public moderation log.
- **Must-respond threshold.** When a request reaches **25 votes**, the time of crossing is recorded. Until the leader responds, the request shows "Awaiting response · N days". The threshold is a published constant and will be tuned once real usage exists.
- **Merging duplicates.** When a moderator merges a duplicate, its votes move to the original (one per member) and the original shows "N duplicates merged in".

## 3c. Mock election ballots
Each upcoming election on a place page has a mock ballot.
- **One ballot per verified member per election, private by design.** The database records only *that* an account voted in that election, with no candidate and no time. Choices exist only as anonymous per-candidate totals. A ballot can't be changed.
- **Results appear only after you vote,** and always show n and the self-selected-sample label.
- **Residency is self-declared today.** Members confirm they vote in that election. It will be checked privately once verified-state credentials ship ([EXPERIMENTS.md](EXPERIMENTS.md), idea 1).
- **Accuracy is measured, not claimed.** We don't claim mock ballots predict better than polls. After each election the official result for each candidate is recorded, and the page shows the mean absolute error in percentage points between the mock results and the official count. Over time that builds a public track record.

## 4. User contributions (moderator-approved)
- **Missing items:** bills, orders or rulings the feeds missed. Each needs an approved source ([SOURCES.md](SOURCES.md)).
- **Context and impact notes:** who an item affects and how, with sources.
- **Proposed bill ideas:** user-drafted ideas that others discuss and poll on. These are clearly labeled *"Citizen proposal, not legislation."*

## 5. Later scope
County and city legislation, state court rulings, and all remaining states (the remaining states come before the first release).
