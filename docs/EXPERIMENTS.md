# Experimental Ideas: Decisions

| # | Idea | Decision |
|---|---|---|
| 1 | Unlinkable verified voting | **Adopted**, with demographic breakdowns limited to verifiable attributes |
| 2 | Bridging-based ranking | **Adopted** |
| 3 | Sortition juries | **Rejected** |
| 4 | Opinion maps | **Adopted, modified** |
| 5 | Auto-proposed citations | **Adopted, moderator-only** |

## 1. Unlinkable verified voting: ADOPTED
- **How a vote works.** For each poll, the client asks for a ballot token. The request is signed with the user's passkey, and the server checks that the user is verified and hasn't already received a token for that poll.
  - The token is signed blindly, using RSA blind signatures ([RFC 9474](https://www.rfc-editor.org/rfc/rfc9474)). The idea is similar to [Privacy Pass](https://datatracker.ietf.org/wg/privacypass/about/).
  - The ballot is submitted with the unblinded token, so the server can confirm the token is genuine but can't tell whose it is.
- **Integrity.** Each token can be spent once. Tally hashes are published.
- **Demographic breakdowns.** Only age bracket and state, both verifiable.
  - These attributes are carried inside the credential, so no per-user demographic record exists.
  - A breakdown is shown only when the group has at least 50 people, and comparing results across polls is restricted.
- **Not offered: ethnicity, religion, gender.** These were considered and rejected. Moderators can't reliably verify them, and collecting proof would mean holding the most sensitive data there is.
- **Design record.** See [ADR 0005](adr/0005-unlinkable-ballots.md).

## 2. Bridging-based ranking: ADOPTED
- **What it does.** Content ranks higher when users who usually disagree both endorse it. The model is matrix factorization, as in X's Community Notes ([Community Notes ranking](https://communitynotes.x.com/guide/en/under-the-hood/ranking-notes); [Wojcik et al., 2022](https://arxiv.org/abs/2210.15723)).
- **Where it's used:**
  - the default feed
  - the weight of citation reactions
  - comments
  - Humanity content

## 3. Sortition juries: REJECTED
- **Founder's reasoning.** Randomly selected users are often not informed on a topic.
- **Instead.** Removal is reserved for clear misinformation. Everything else gets a context note ([MODERATION.md](MODERATION.md)).

## 4. Opinion maps: ADOPTED (modified)
- **Clustering.** Opinions on a forum topic are grouped the way [Pol.is](https://compdemocracy.org/Polis/) groups them.
- **Lenses.** Users **choose** a lens: Left, Moderate, Right, or All. The choice is never based on their own affiliation.
  - Moderate shows opinions not strongly supported by either the left or the right.
  - Left shows opinions from across the Democratic diaspora.
  - Right shows opinions from across the Republican diaspora.
- **How a cluster's lean is decided.** By how much the cluster agrees with party leaders' public positions. This method will be refined during the build and documented.
- **Common ground.** Statements that reach consensus across clusters feed the Humanity / Common Ground section.

## 5. Auto-proposed citations: ADOPTED (moderator-only)
- **How drafts are made.** Roll-call votes and signed actions are matched to the leader's declared stance in the relevant CRS policy area. The system then drafts a positive or negative citation.
- **Who decides.** **Only moderators** can approve or delete a draft. Contributors cannot.
- **Details.** See [LEGISLATION.md](LEGISLATION.md).
