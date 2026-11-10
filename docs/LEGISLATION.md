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
- This is an interim design until unlinkable ballots ([EXPERIMENTS.md](EXPERIMENTS.md), idea 1) replace it.

## 3b. Leader requests
Each leader page has a Requests tab where members post what they most want that leader to do and upvote others' requests, one vote per member. Requests are public posts, like forum posts. They are sorted by votes.

## 4. User contributions (moderator-approved)
- **Missing items:** bills, orders or rulings the feeds missed. Each needs an approved source ([SOURCES.md](SOURCES.md)).
- **Context and impact notes:** who an item affects and how, with sources.
- **Proposed bill ideas:** user-drafted ideas that others discuss and poll on. These are clearly labeled *"Citizen proposal, not legislation."*

## 5. Later scope
County and city legislation, state court rulings, and all remaining states (the remaining states come before the first release).
