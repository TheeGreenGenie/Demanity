# ADR 0004: Verification paths

- **Status:** Accepted (2026-11-09). Updated after reviewing the SheerID API reference.
- **Requirements:** R1, R9, R10

## Context
- SheerID's main role for Demanity is to **prevent duplicate users**.
- Eligibility is limited to **US citizens aged 18 or older**.
- The founder's rule:
  - A US-issued ID or passport means the person is admitted.
  - A non-US document means the person is denied, unless a moderator overrides.
  - If SheerID can't tell where a document was issued, admit on proof of age 18+ and handle citizenship later.

## Findings from the SheerID API reference ([developer.sheerid.com/reference](https://developer.sheerid.com/reference#api-reference))
- **Verification types.** There are 15 segments, each with an operation named `submit<Segment>VerificationWithProgramId`. Three matter for Demanity:
  - **Driver License** (`submitDriverLicenseVerificationWithProgramId`). Fields: `firstName`, `lastName`, `state` (a two-character **US state code**), `driverLicenseNumber`, `email`. This verifies a **US-issued** driver's license.
  - **Age** (`submitAgeVerificationWithProgramId`). Covers the 18+ requirement.
  - **General Identity** (`submitGeneralIdentityVerificationWithProgramId`). It has no document fields.
- **No passport segment** is listed. Documents can be submitted through the `docUpload` step and the `documentReview` verification type, but the reference doesn't say whether a passport upload can confirm its issuing country.
- **No citizenship, nationality or document-type field.** The `country` fields that do exist describe the person being verified, not the country that issued the document.
- **No duplicate-person detection is documented.** The fraud signals that are documented: `deviceFingerprintHash`, the `fraudRulesReject` error, `captchaToken`, and the `verificationLimitExceeded` and `reverificationDailyLimitExceeded` errors. `externalUserId` is an integrator-supplied reference.

## Decision
- **Primary path (Path A, driver's license):**
  - The user verifies with SheerID **Driver License** (US state plus license number) **and** **Age** (18+). Both checks passing means the user is admitted automatically.
  - Anyone without a US driver's license gets a moderator review queue, which is the override path for cases such as a state ID or a passport. Every override is logged with a reason code.
- **Deduplication:**
  - The uniqueness token ([ADR 0002](0002-uniqueness-token-and-identity-vault.md)) is a keyed one-way hash of identity attributes **the user submits**.
  - It is computed in the vault's memory **before** the request is sent to SheerID. The raw values are then discarded.
  - Demanity owns deduplication itself and does not rely on the vendor.
  - The exact attribute set is kept in the private security notes.
- **Fallback B (18+ only):** if Driver License verification turns out to be unavailable for this kind of program, users are admitted through **Age** alone, and US citizenship becomes a documented gap to close before first release.

## Known limitations
- **A US driver's license proves a US-issued ID, not US citizenship.** Many lawful non-citizen residents hold one.
  - **Founder decision (2026-11-09): a US-issued ID is the accepted eligibility standard for the MVP.**
  - Whether to tighten the standard to citizenship gets revisited before first release.
- **Other security considerations** for this flow are maintained privately. Vetted contributors can request access ([CONTRIBUTING.md](../../CONTRIBUTING.md#sensitive-documents)).

## Still to confirm with SheerID (Phase 0)
- [ ] Driver License and Age verifications are available for our program type
- [ ] Whether a passport can be verified through `documentReview`, and whether the issuing country can be confirmed
- [ ] Whether SheerID offers any cross-verification duplicate detection that isn't documented
- [ ] Pricing for each verification
