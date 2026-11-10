# Privacy and Breach Design (R1, R3)

**Goal:** a breach must not dox users or expose their political views. Demanity stores no personal information a user did not volunteer, and no data from SheerID.

## 1. What is stored
| Data | Where | Form |
|---|---|---|
| Uniqueness token | Identity vault | `HMAC-SHA256(vault_secret, normalized identity attributes)`. Irreversible. Raw values are discarded in memory ([ADR 0002](adr/0002-uniqueness-token-and-identity-vault.md)). |
| 2FA email (default) and/or phone (optional) | Identity vault | Encrypted with per-record data keys, which are wrapped by a key-management service. A separate keyed hash allows lookups. |
| Passkey public keys | Activity DB | Public keys only. Private keys never leave the device. |
| Pseudonymous account | Activity DB | Random ID, chosen username, and posts, comments, reactions and follows |
| Poll ballots | Ballot store | **Not linked to any account** ([ADR 0005](adr/0005-unlinkable-ballots.md)) |
| Demographic attributes (age bracket, state) | Only inside the user's anonymous credential on their device | The server keeps no per-user demographic record, so this data can never be sold or leaked. |
| Volunteered location | Activity DB | County level or coarser, optional |
| IP addresses | Rate limiter | Hashed and kept for 24 hours or less. No analytics SDKs, no tracking cookies. |

**Never stored:** names, dates of birth, ID documents, SheerID payloads, behavioral ad profiles.

**Third-party processors.** These services see limited data in order to deliver a function. They never see any political activity.
- **SheerID** (identity verification): sees the identity attributes submitted during verification.
- **Resend** (default 2FA, email delivery only): sees the email address and the message containing the code. Demanity generates and checks codes itself and stores them only as hashes.
- **Twilio Verify** (optional SMS 2FA, enabled only if configured): sees the phone number when it sends a code.

## 2. Separation
- The **identity vault** is a separate service with its own database, its own credentials and its own key-management keys.
- The **link** between the vault and an account in the Activity DB exists only in the vault, and it is encrypted.
- **Production access is split.** No single staff role can read both stores.

## 3. Breach outcomes
| What leaks | What an attacker learns |
|---|---|
| Activity DB | Pseudonymous public activity, which is already mostly public |
| Identity vault without keys | Nothing readable |
| Identity vault with keys | Contact details, with no political activity attached |
| Ballot store | Ballots that cannot be linked to accounts |

## 4. Honest limitations
- Public posts, writing style and volunteered details can still identify a person. Users are told this during onboarding.
- Legal demands can only reach data that exists. Minimal data means very little can be handed over.

## 5. Commitments
- **Demanity never sells user data.**
- Any future ads are contextual only and never tailored to user data.
- Accounts can be deleted. The uniqueness token is retained so the "one account ever" rule still holds. Retaining it is disclosed in the Terms of Service.
