# Ads policy (R11)

**At launch Demanity shows no ads.** Funding starts with donations after the MVP ([VISION.md](VISION.md)).

If ads are ever added, these rules apply and the architecture already enforces the first two:
1. **Contextual only.** An ad may be chosen only from the page's topic (for example "bill:health"). The slot endpoint, `GET /v1/ads/slot?context=…`, accepts nothing else and never reads the session, so who is looking can't affect which ad appears. A test checks that guests and members get the same answer.
2. **Off by default.** `ADS_ENABLED` is a constant set to `false` in `apps/api/src/routes/transparency.ts`, not an environment variable. Turning ads on takes a reviewed code change, not a configuration switch.
3. **Never political:** no ads from candidates, parties, PACs or issue campaigns.
4. **Public ad ledger:** every advertiser, amount and the contexts it ran in, published in the quarterly [transparency report](TRANSPARENCY-REPORT-TEMPLATE.md).
5. **Ad-free supporter tier.**
6. **No tracking:** no ad SDKs, no third-party cookies, no measurement pixels.

Changing this policy goes through the cross-partisan process in [GOVERNANCE.md](../GOVERNANCE.md).
