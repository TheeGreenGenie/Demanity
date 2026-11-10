# ADR 0005: Unlinkable ballots

- **Status:** Accepted (2026-11-09)
- **Requirements:** R3, R6, R7

## Decision
1. **Request a ballot token.** The client asks for a ballot token for a specific `poll_id`. The request:
   - is signed with the user's **passkey**, as a WebAuthn challenge-response;
   - carries a **blinded** token message.
2. **Issue the token.** The server checks that the user is verified and has not already received a token for this poll. It then records `(account, poll_id)` as issued and signs the blinded message using **RSA blind signatures** ([RFC 9474](https://www.rfc-editor.org/rfc/rfc9474)).
3. **Cast the ballot.** The client unblinds the signature and submits `(token, signature, choice)` over a separate request. That request carries no account credentials.
4. **Record the vote.** The ballot store checks the signature and enforces `UNIQUE(token)`. It never sees the account.
5. **Changing a vote.** Users can change their vote until the poll closes. The new ballot reuses the same token and replaces the earlier choice. The token itself stays unlinkable.
6. **Audit trail.** Tally hashes are published at regular intervals and when the poll closes.

## Demographic attributes
- **Which keys sign the token.** The poll uses a separate signing key for each combination of verified attributes (age bracket × state). The key used reveals only that combination.
- **Minimum group size.** A breakdown is shown only when the group has at least **50** people.
- **Restricted cross-poll queries.** Queries that compare results across polls are limited.

## Security considerations
- The threat analysis and mitigations for this design are maintained privately. Vetted contributors can request access ([CONTRIBUTING.md](../../CONTRIBUTING.md#sensitive-documents)).
- The cryptography library will be chosen only after an independent security review.
