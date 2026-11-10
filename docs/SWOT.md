# SWOT Analysis, Targeted Changes and Competitive Landscape

## 1. SWOT

### Strengths
- Verified one-person-one-account, with unlinkable ballots.
- Privacy-first architecture: a breach does not dox political views ([PRIVACY.md](PRIVACY.md)).
- Leaders are measured against their *own* declared stances, which is less partisan than ideological scoring.
- A full legislation tracker tied to leader actions.
- A feed the user controls, plus bridging ranking.
- Context on everything, including the opt-in "Does this citation offend you?" tab.
- A Humanity section that offsets divisiveness.
- AGPL open source, plus the organization's own accountability page.
- Mobile-first, aimed at Gen Z and millennials.

### Weaknesses
- **Citizenship:** verification may fall back to age 18+ only if SheerID cannot determine where an ID was issued ([ADR 0004](adr/0004-verification-paths.md)).
- **Moderation load:**
  - verification overrides
  - essay reviews
  - three-moderator fact-check panels
  - approving user contributions to legislation pages
  - approving auto-proposed citations
- **Scoring:** the overall score and the other combined measures are not finalized ([SCORING.md §4](SCORING.md#4-overall-score-alignment-helphurt-️-review-before-release)).
- **Data gaps:** data on governor executive orders and on candidates is patchy, because there is no single national source.
- **Demographics:** demographic breakdowns are limited to attributes we can verify (age bracket, state).

### Opportunities
- **Free official data APIs:**
  - [Congress.gov API](https://api.congress.gov/)
  - [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1)
  - [Open States](https://openstates.org/)
  - [CourtListener](https://www.courtlistener.com/help/api/)
  - [OpenFEC](https://api.open.fec.gov/developers/)
- **An underserved market** (see §3).
- Civic-tech grants and an open-source contributor community.
- Aggregate verified-opinion data for journalists and researchers.

### Threats
- **Legal:**
  - Defamation claims over citations.
  - Section 230 protects platforms from liability for third-party content ([47 U.S.C. § 230](https://www.law.cornell.edu/uscode/text/47/230)). It does not protect content the platform creates itself, so computed scores need legal review.
  - State privacy laws.
  - The [IRS rules for 501(c)(4)s](https://www.irs.gov/charities-non-profits/other-non-profits/social-welfare-organizations) require that political campaign activity not be the organization's primary activity.
- **Abuse:** account buying, coordinated campaigns, foreign influence operations, insider abuse ([ABUSE.md](ABUSE.md)).
- **Perception:** being labeled partisan ([NONPARTISANSHIP.md](NONPARTISANSHIP.md)).
- **Cold start:** samples are small at first. Mitigation: always show n and confidence.

**Scoped out by the founder:**
- *Vendor pricing or API changes:* treated as a normal cost of building software, not as a strategic threat.
- *Brigading of citations:* treated as democratic expression. Moderation handles clear misinformation, hate based on race, gender or religion, and undue harassment.

*None of the legal points above is legal advice. Counsel must review all of them before launch.*

## 2. Targeted changes for weak spots
| Weak spot | Change |
|---|---|
| Citizenship verification | Path A / Fallback B, documented in [ADR 0004](adr/0004-verification-paths.md). Moderator overrides are logged. |
| Moderation load | Queues with service-level targets, reason codes and auto-routing. AI pre-screening for fact-checks only, never as the final decision. Published transparency reports. |
| Lost device | Required 2FA, multiple passkeys, and moderator-assisted recovery through re-verification. |
| "All politicians" has no single data source | Sitting officials and filed candidates only. Pages are deprecated when a leader leaves office. MVP covers federal plus 5 states. |
| Doxxing risk | A separate identity vault, unlinkable ballots and pseudonyms ([PRIVACY.md](PRIVACY.md)). |
| Insider abuse | Append-only public logs, scoring changes announced publicly and delayed before taking effect, the organization's leader page, and the governance plan. |
| Poll integrity | Layered protections: one verified person, a device-signed request and one unlinkable ballot per poll, with publicly auditable tally hashes. The full set of protections is documented privately. |

## 3. Competitive landscape
Researched 2026-11-09. The descriptions mostly come from each vendor's own marketing and have not been independently verified.

| Product | Overlap | Gap Demanity fills |
|---|---|---|
| [PolisWatch](https://poliswatch.com/) | Promise tracking, community-verified claims, "trust scores". The closest rival. | No verified identity. No forums or Humanity section. Not stated to be open source. |
| [CivicView](https://play.google.com/store/apps/details?id=app.civicview&hl=en_US) / [CivicVoice](https://civicvoiceapp.com/) | Verified-constituent polls, scorecards | Focused on districts and messaging. Subscription features. |
| [CitizeX](https://www.prnewswire.com/news-releases/verified-civic-engagement-platform-citizex-launches-to-provide-trusted-bipartisan-dialogue-302732931.html) | Verified-only dialogue (launched April 2026) | No trust pages or citations |
| [ActiVote](https://www.activote.net/), [Votary](https://votary.us/), [Zivic](https://zivic.app/), [CivicAlign](https://www.civic-align.com/) | Polls, candidate discovery, AI summaries | Not centered on accountability |
| [Countable](https://en.wikipedia.org/wiki/Countable_(company)) / Brigade / Causes | Same space. The consumer app is listed as [inactive](https://directory.civictech.guide/listing/countable) after a pivot to enterprise customers. | **Lesson:** sustainable funding matters |

**Positioning:** we found no product that combines all of the following:
- verified uniqueness
- signed, unlinkable polls
- crowd-cited trust pages for every federal and state official
- a legislation tracker
- location pages
- a Humanity section
- AGPL open source
