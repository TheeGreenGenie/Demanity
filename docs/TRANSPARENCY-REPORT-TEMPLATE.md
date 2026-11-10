# Transparency Report: [Quarter, Year] (template)

Demanity publishes one report per quarter (R28; [NONPARTISANSHIP.md](NONPARTISANSHIP.md)). Fill in every section; write "none" rather than leaving one out.

**Automatic numbers:** `GET /v1/transparency?from=YYYY-MM-DD&to=YYYY-MM-DD` returns the counts marked *(auto)*. It covers at most one year per request, uses only public records, and never identifies an account, username or moderator. Paste its output into the appendix.

## 1. Summary
- Period: [from] to [to]
- Verified members at period end: [n]
- Moderators at period end: [n] *(auto)*; declared leans: left [n], center [n], right [n] *(auto)*
- The three biggest changes this quarter, in plain language: [ ]

## 2. Moderation actions *(auto)*
| Action | Reason code | Actor (moderator / system) | Count |
|---|---|---|---|
| | | | |

Explain any large change from last quarter.

## 3. Symmetric enforcement *(auto)*
Citation decisions grouped by the **cited leader's party** and the citation's direction.

| Party | Direction | Accepted | Rejected | Removed | Pending |
|---|---|---|---|---|---|
| | | | | | |

- Rejection and removal rates by party, with sample sizes: [ ]
- If the rates differ noticeably, explain why (for example, a few prolific submitters) and what was checked: [ ]
- External auditor's notes (when an audit was done): [ ]

## 4. Fact-checks *(auto)*
| Trigger (flags / author request / reversal) | Outcome | Count |
|---|---|---|
| | | |

- Reversals requested: [n]. Reversals that changed the outcome: [n]
- AI first pass: enabled? [yes/no]. Model: [ ]. Drafts produced: [n]. Drafts that flagged an injection attempt: [n]. (See [ADR 0009](adr/0009-ai-fact-check-first-pass.md).)

## 5. Appeals *(auto)*
| Status | Count |
|---|---|
| | |

## 6. Accounts and verification (by hand)
- Verification overrides by moderators: approved [n], denied [n]
- Bans: [n], by reason code
- Accounts recovered with moderator help: [n]
- Automatic contributor revocations: [n] *(auto: `contributor.revoked_automatically`)*

## 7. Government and legal requests (by hand)
| Type (subpoena, court order, national security letter, other) | Received | Complied | Partially | Refused |
|---|---|---|---|---|
| | | | | |

What was disclosed, in general terms. Remember what Demanity cannot hand over: votes are unlinkable, and the identity vault holds no activity ([PRIVACY.md](PRIVACY.md)).

## 8. Security and privacy (by hand)
- Security incidents: [none / description, impact, fix]
- Data breaches: [none / what was exposed, as described in PRIVACY.md §3]
- Outbound API usage against budgets ([ADR 0008](adr/0008-outbound-api-budgets.md)): any budget exhausted? [ ]

## 9. Money and ads (by hand)
- Ads: [none shown] *(auto: `ads.enabled`)*. See [ADS.md](ADS.md).
- Donations: total [ ], number of donors [n], donors above the disclosure threshold listed in [ ]
- No party or campaign money accepted: [confirm]

## 10. Organization decisions
- Member proposals that crossed the response threshold: [n], each with a link to Demanity's public response.
- Changes to scoring, sources or the taxonomy, each with its 30-day comment period dates: [ ]

## Appendix: raw output
```json
[paste /v1/transparency output]
```
