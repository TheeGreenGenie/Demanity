# ADR 0002: Uniqueness token and identity vault

- **Status:** Accepted (2026-11-09)
- **Requirements:** R1, R3, R26

## Context
- Each person may have one account, ever.
- Demanity may not store any SheerID data.
- A data breach must not expose who holds which political views.

## Decision
1. **Uniqueness token.** At verification time, the identity vault computes the token in memory:

   `token = HMAC-SHA256(vault_secret, normalize(stable identity attributes from the verification result))`

   Raw values are discarded immediately afterwards. A uniqueness constraint on `token` blocks re-registration. **Which attributes count as "stable" will be confirmed with SheerID in Phase 0.**
2. **Identity vault.** A separate service and database that holds:
   - the token;
   - the 2FA email and/or phone, encrypted with key-management data keys, plus a keyed lookup hash;
   - the encrypted link to the pseudonymous account ID.
3. **Activity database.** Holds only pseudonymous IDs. No staff role can access both stores.
4. **Secret management.**
   - `vault_secret` lives in the key-management service.
   - Rotation needs a re-keying plan, because a rotated secret changes every token. The plan is to keep versioned secrets and re-hash each account the next time it verifies.

## Consequences
- **Irreversible.** The token cannot be turned back into a person's identity, but it still detects repeat registrations.
- **Survives deletion.** Deleted accounts keep their token. The Terms of Service disclose this.
- **Security considerations.** Threat analysis and mitigations for this design are maintained privately. Vetted contributors can request access ([CONTRIBUTING.md](../../CONTRIBUTING.md#sensitive-documents)).
