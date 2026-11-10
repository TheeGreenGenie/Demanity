# Demanity: Product Vision and Specification

> **Demanity** is a not-for-profit, open-source **government accountability** platform for verified US citizens 18+. It tracks what government actually does: every new law, order, regulation and ruling, and how each leader acts on it. It measures verified public opinion honestly, holds leaders to their own stated positions, gives context on everything, and counters division by highlighting the good people do for each other.

## Requirement IDs
The R-numbers used across the docs refer to the product requirements below. They describe *what* Demanity must do. Issues, pull requests and design discussions should cite the requirement they serve, e.g. "Implements R14 (VS comparison)".

| R# | Requirement |
|---|---|
| R1 | One verified account per person, ever |
| R2 | Guests can browse read-only but cannot interact |
| R3 | No personal information is stored unless the user volunteers it; no SheerID data is stored; a breach must not reveal political views |
| R4 | Node.js/TypeScript stack with a mobile app (Expo) |
| R5 | Forums and polls are the core of the product |
| R6 | Voting requires a device key and a two-way handshake; forums are less strict |
| R7 | Polls cannot be skewed by anyone |
| R8 | Users can follow users, topics, locations, leaders and bills |
| R9 | Users must be US residents with a US-issued ID and aged 18+ (see §4) |
| R10 | The moderation team has final control over verification and moderation |
| R11 | Not-for-profit (501(c)(4)); ads are never tailored to user data |
| R12 | Leader trust page: stances, citations, "Accurate?" and "Approve?" buttons |
| R13 | Versioned categories based on CRS policy areas; per-category score, overall score, alignment, help/hurt |
| R14 | Head-to-head (VS) comparison of leaders |
| R15 | Subgroups; reposting of forums, leaders, citations and bills |
| R16 | Feed controlled by the user, with a transparent default |
| R17 | Pages for sitting officials and filed candidates; leaders who claim their page cannot edit it or cite themselves; pages are deprecated when a leader leaves office |
| R18 | Humanity section |
| R19 | SWOT analysis, specification, targeted fixes, supporting ideas, experiments |
| R20 | Open source, with researched licensing |
| R21 | Design questions resolved before building; work tracked to completion |
| R22 | Organization leader page with advisory votes and a required public response |
| R23 | All new legislation is tracked |
| R24 | Users contribute to legislation pages, with moderator approval |
| R25 | Fact-checking: an AI first pass, then 3 independent moderators |
| R26 | Required 2FA by email or phone, plus moderator-assisted recovery |
| R27 | Abuse documented, plus Terms of Service covering bans and legal action |
| R28 | Bipartisan governance |
| R29 | Context everywhere, including the opt-in "Does this citation offend you?" tab |
| R30 | MVP covers federal government plus CA, TX, FL, NY and PA |
| R31 | Research-based method for the overall score, alignment and help/hurt (review before release) |
| R32 | Location pages for court districts, counties, cities and states |
| R33 | Every factual claim cites an approved source; fact-checks can be reversed |
| R34 | The scoring methodology is open to contributor review |

---

## Development roadmap (public overview)
The core team keeps a detailed internal task list. It is not published because it tracks security-sensitive work in progress. The public sequence is:

1. **Foundation:** repository, tooling, continuous integration, legal setup.
2. **Identity and access:** verification, accounts, passkeys, 2FA, guest mode.
3. **Social core:** forums, follows, feed, Humanity section, the organization page.
4. **Legislation and locations:** data ingestion for federal government and the 5 MVP states, plus location pages.
5. **Leaders and scoring:** leader pages, trust pages, VS comparison.
6. **Polls:** verified, unlinkable voting.
7. **Contributors and moderation:** citations, fact-checking, context notes.
8. **Ranking and opinion maps:** bridging ranking and lens views.
9. **Hardening and MVP launch.**
10. **Before first release:** public review of everything marked REVIEW, plus all 50 states.

Open tasks are posted as GitHub Issues once they are safe to discuss publicly.

---

## 1. Purpose and principles
1. **Accountability over outrage.** Leaders are measured against *their own declared stances*, not against a platform ideology.
2. **One person, one voice.** Each verified person has one account (R1) and casts one ballot per poll (R7).
3. **Privacy by architecture.** A breach must not reveal anyone's political views (R3). See [PRIVACY.md](PRIVACY.md).
4. **The user controls the feed.** No hidden engagement algorithm (R16).
5. **Context on everything.** Every number explains what it means and what it doesn't (R29).
6. **Every fact is cited.** Every factual claim cites an approved source (R33). See [SOURCES.md](SOURCES.md).
7. **Nonpartisan by governance**, not just by promise (R28). See [NONPARTISANSHIP.md](NONPARTISANSHIP.md).
8. **Humanity first.** A permanent space for common ground (R18).

## 2. Scope
| | MVP | First release | Later |
|---|---|---|---|
| Government levels | Federal + CA, TX, FL, NY, PA (R30) | All 50 states | County, city, state courts |
| Platforms | Expo app (iOS, Android, web) | Same | Same |
| Funding | None; fundraise after MVP | Donations, grants, contextual ads | Same |

## 3. Users and roles
| Role | Can do |
|---|---|
| **Guest** | Read all public content. No tracking cookies. No interaction (R2). |
| **Verified user** | Post, comment, react, follow, repost, vote in polls, apply to be a contributor. |
| **Contributor** (per category) | Submit citations and devil's-advocate entries in their approved categories. Join that category's anonymous contributor chat. |
| **Leader** (claimed page) | Everything a user can do, plus posting on their own leader profile and contributing citations in any category under their own name. **Cannot** edit their trust page or cite themselves (R17). |
| **Moderator** | Verification overrides, approvals, fact-check panels, context notes, takedowns. All actions are logged publicly (R10). |
| **Organization** | Has its own leader page, where users vote on platform decisions (R22). |

## 4. Identity, verification and access (R1, R9, R26)
- **Verification ([ADR 0004](adr/0004-verification-paths.md)):**
  - **Path A:** SheerID **Driver License** verification (US state and license number) plus SheerID **Age** verification (18+). The user is admitted automatically. Anyone without a US license (passport, non-US document) goes to a moderator review queue, and every override is logged.
  - **Fallback B:** if Driver License verification is unavailable, admit on age 18+ only.
  - **Accepted for the MVP:** a US-issued ID is the eligibility standard. A US driver's license proves a US-issued ID, not citizenship, and the founder accepts this for the MVP stage. Whether to tighten the standard to citizenship gets revisited before first release.
- **Deduplication ([ADR 0002](adr/0002-uniqueness-token-and-identity-vault.md)):** a keyed one-way token computed from the state and license number the user enters, before anything is sent to SheerID. SheerID documents no duplicate detection, so we don't rely on it. No SheerID data is stored.
- **Device key:** a WebAuthn passkey ([W3C WebAuthn](https://www.w3.org/TR/webauthn-3/)). Voting requires a challenge-response signature from the device. Several devices are allowed.
- **2FA (required):** at least one of a secure email or a phone number, kept in the identity vault.
  - **Email is the default and free:** the vault generates and checks its own one-time codes; an email service only delivers them.
  - **SMS is optional:** available only when a provider (Twilio Verify) is configured, because text messages always cost money.
  - **Lost device:** authenticate with 2FA, then register a new passkey. Old keys are revoked.
  - **Lost 2FA too:** contact moderation and re-verify. The re-verification maps to the same uniqueness token, and the account is rebound.
- **Age:** 18+ only. This keeps the platform outside the FTC's COPPA rule, which covers children under 13 ([FTC COPPA](https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa)), and matches voting age.

## 5. Core features

### 5.1 Forums (R5, R15)
- Subgroups by topic, location and bill.
- Posts, threaded comments, reactions and reposts.
- An automatic slow mode turns on for heated threads.
- A "read before repost" nudge appears for unopened links.

### 5.2 Polls (R5, R6, R7)
- **One ballot per person, unlinkable to the account:** a blind-signature ballot token ([ADR 0005](adr/0005-unlinkable-ballots.md)), requested with a passkey signature.
- **Results:**
  - hidden until you vote, then shown with sample size (n);
  - always labeled: *"Demanity users are a self-selected group; results do not represent all Americans."*
- **Demographic breakdowns:**
  - only by **verifiable** attributes (age bracket, state), carried inside the anonymous credential;
  - shown only for groups of 50 or more;
  - protected against comparing results across polls to single people out.
- **Integrity:** tally hashes are published so anyone can audit the count. There is no "edit vote" code path.

### 5.3 Follows (R8)
Users can follow other users, topics, locations, leaders, bills and committees.

### 5.4 Leader pages (R12, R13, R17)
- **Who has a page:**
  - every sitting federal official and every sitting official in the MVP states;
  - **candidates**, once they file to run.
- **Lifecycle:** retirement, leaving office or death makes the page read-only and freezes its scores.
- **Profile (claimable):**
  - Verified leaders post, repost, run polls and interact like any user.
  - Their contributions are always named.
- **Trust page (crowd-governed):**
  - **Stances**, one per category, each with a stance timeline.
  - **Citations:** sourced positive or negative actions measured against a stance. Each citation has two buttons:
    - **"Accurate?"** feeds the score;
    - **"Approve?"** is displayed but never scored.
  - **Scores:** per-category scores, an overall score, "most aligned with" and "projected to help / hurt most". See [SCORING.md](SCORING.md).
  - **"Does this citation offend you?"** (opt-in). See §5.10.

### 5.5 VS comparison (R14)
Any two leaders side by side: every category score, the overall score, stance differences and citation counts.

### 5.6 Organization leader page (R22)
- Users vote on Demanity's own decisions.
- Votes are **advisory, but Demanity must publicly respond** to any vote above a participation threshold.
- Moderators may add context notes to counter misinformation.
- There are no score categories yet. The schema supports adding them later.

### 5.7 Feed (R16)
- **User control:** sources, weights, ordering and mute rules.
- **Optional default:**
  1. the user's past interests;
  2. topics that people with overlapping interests support or condemn;
  3. re-ranked with bridging (see [EXPERIMENTS.md](EXPERIMENTS.md) #2).
- **"Why am I seeing this"** on every item.
- **Shareable feed recipes.**

### 5.8 Humanity section (R18)
- Positive acts, democracy working, and the ways we're alike.
- No scores and no dislikes; **kudos** instead.
- A weekly **Common Ground** digest, built from bridging-ranked content and opinion-map consensus statements.

### 5.9 Legislation tracker (R23, R24)
See [LEGISLATION.md](LEGISLATION.md). In short:
- **Coverage:** federal and state bills, presidential and gubernatorial executive orders, federal regulations and court rulings.
- **Pages:** each item gets a page with a forum, a poll and links to the leader pages of everyone involved.
- **User contributions** (moderator-approved): missing items, context and impact notes, and proposed bill ideas.

### 5.10 Context and the "offend" tab (R29)
- Every poll, score and citation has an explainer.
- **"Does this citation offend you?"** is a link the user must deliberately open. It is never shown by default, because the contents could upset strong supporters. It opens:
  1. a general explanation: people live in different circumstances, have different needs and life experiences, and reasonable people disagree;
  2. "Here are some reasons this citation may not reflect your view", made of **devil's-advocate entries** from contributors. Users vote on them, and well-received entries earn contribution points.

### 5.11 Location pages (R32)
See [LOCATIONS.md](LOCATIONS.md). One page per federal judicial district, county, city and state. Each shows:
- the leaders representing that place and their trust scores;
- new legislation;
- an outlook on proposed legislation, based on trust scores;
- the biggest problems by category, from official data.

### 5.12 Contributors
- **Application:** a per-category essay, reviewed by the team, showing command of current facts.
- **Renewal:** yearly. Status is also revoked automatically if the contribution score falls into low trust.
- **Attribution:** citations are **publicly unattributed**. Leaders' citations are always named.
- **Chats:** anonymous per-category contributor chats with pseudonymous handles. Moderators and the app keep them supplied with the latest legislation in the category.
- **Contribution score:** see [SCORING.md §5](SCORING.md#5-contribution-score).

### 5.13 Moderation and fact-checking (R10, R25, R33)
See [MODERATION.md](MODERATION.md).
- **Removal is reserved for:** clear misinformation, hate based on race, gender or religion, and undue harassment.
- **Everything else gets a context note.**
- **Fact-check pipeline:** an AI first pass, then three independent moderators.
- **Reversal:** a different panel of moderators can reverse any fact-check.

## 6. Funding and ads (R11)
- The MVP has no ads. Fundraising starts after the MVP.
- Any future ads are **contextual only and never tailored to user data**. There are no political or issue ads, there is a public ad ledger, and supporters can choose an ad-free tier.

## 7. Technology (R4)
See [ADR 0001](adr/0001-stack-node-expo.md):
- Node.js/TypeScript monorepo
- Expo (React Native) universal app
- Fastify API
- PostgreSQL, Redis, Meilisearch
- BullMQ ingestion jobs
- a separate identity-vault service

## 8. Organization (R11, R28)
- **Entity:** a 501(c)(4) social welfare organization ([IRS](https://www.irs.gov/charities-non-profits/other-non-profits/social-welfare-organizations)). Under IRS rules, political campaign activity must not be its primary activity, and donations are not tax-deductible.
- **Legal review:** required before launch.
- **Governance:** see [GOVERNANCE.md](../GOVERNANCE.md) and [NONPARTISANSHIP.md](NONPARTISANSHIP.md).

## 9. Assumptions
- At MVP, location pages list federal and state officials only. "Court district" means the 94 federal judicial districts ([US Courts](https://www.uscourts.gov/about-federal-courts/court-role-and-structure)).
- "Contribute to legislation" means three things: submitting missing items, writing context and impact notes, and proposing bill ideas.
- The AI fact-check uses a pluggable LLM provider.
- The 50-person breakdown minimum and the flag thresholds are config values, not constants.
