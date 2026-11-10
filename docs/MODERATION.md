# Moderation, Fact-Checking and Context (R10, R25, R29, R33)

## 1. Principles
- **Content is removed only for:**
  - clear misinformation;
  - hate based on race, gender or religion;
  - undue harassment or criticism that targets a person rather than their record;
  - abuse as defined in [ABUSE.md](ABUSE.md).
- **Everything else gets a context note**, in the style of community notes. A context note adds information; it does not remove the post.
- **Every action is logged.** Each moderation action is written to an append-only public log with:
  - a reason code;
  - the moderator's role (not the moderator's identity);
  - a timestamp.
- **Every decision can be appealed.** Appeals go to moderators who were not part of the original decision.

## 2. Verification control
The moderation team has final authority over who is verified:
- override a denial, for example a non-US document in a legitimate case;
- revoke a verification;
- handle account recovery.

Every override records a reason code. Overrides also count toward the symmetric-enforcement audits in [NONPARTISANSHIP.md](NONPARTISANSHIP.md).

## 3. Context notes
- Moderators may add a labeled **"Moderator context"** note to any post, comment, poll, citation, legislation item or organization-page vote.
- Each note must cite an approved source ([SOURCES.md](SOURCES.md)).
- Each note is publicly logged and can be appealed.

## 4. Fact-check pipeline
**Triggers:** a comment enters the pipeline in either of two ways:
- enough verified users flag it, or it reaches a set level of reach (the threshold is configurable);
- its author asks for a "verified" badge on their own factual claim.

**Steps:**
1. **AI first pass.** An LLM agent drafts an assessment and lists sources from the approved list.
   - The comment is treated strictly as data. Any instructions inside it are ignored, as a defense against prompt injection.
   - The AI output is **never** final and is never shown to users as a verdict.
2. **Three independent moderators** review the AI draft and the sources.
   - Each panel includes moderators of mixed political leanings.
   - Panelists cannot see each other's votes until all three have voted.
   - The outcome is decided by majority.
3. **Outcome:** one of four labels:
   - **Verified**
   - **Context added**
   - **Misleading**
   - **Removed**, used only for clear misinformation.
4. **Reversal.** A **different** panel of three, with no members from the first panel, can reverse any outcome. Every reversal is logged publicly.

## 5. Citations and contributors
- **Contributor applications:** applicants write an essay for each category. The team reviews it, and contributors renew yearly.
- **Auto-proposed citations** can be approved or deleted by moderators only.
- **Taking down a citation** costs its contributor 3 points of contribution score.
- **A citation that needed a context note** costs its contributor 1 point.

## 6. "Does this citation offend you?"
- This is an opt-in link. Its contents are never shown unless a user clicks it.
- The page it opens contains:
  1. A general explanation that people live in different circumstances, have different needs and life experiences, and that reasonable people disagree.
  2. "Here are some reasons this citation may not reflect your view," followed by **devil's-advocate entries** written by contributors in that category.
- Users vote on the entries. Entries that are voted helpful earn contribution points ([SCORING.md §5](SCORING.md#5-contribution-score)).
- Entries must follow the citation rule. Abusive entries are removed.

## 7. Context labels shown everywhere
- **Polls:** *"Demanity users are a self-selected group; results do not represent all Americans."*
- **Scores:** a link to the scoring methodology, the number of citations and votes behind the score, and a "low evidence" label where that applies.
- **Location outlook:** *"Outlook based on trust scores, not a prediction of passage."*
- **Help/hurt:** *"Community-assessed impact, not a forecast."*

## 8. Transparency
Quarterly reports publish:
- moderation volume by action and reason code;
- reversals;
- verification override counts;
- symmetric-enforcement statistics.
