# ADR 0008: Budgets for every outbound API call

- **Status:** Accepted (2026-11-10)
- **Requirements:** R23 (ingestion), R26 (2FA delivery); founder request: "rate limit so we don't get rate limited on our API key usages", and outside production, ingest only part of the data.

## Context
Demanity calls third-party APIs with keys that belong to the project:
- **Congress.gov** (api.data.gov key), for bills;
- **Resend**, for email codes;
- **Twilio Verify** (optional, trial), for SMS codes.
- **Open States and CourtListener** keys exist, but nothing calls them yet.

Going over a provider's limit can get a key throttled or suspended, and on paid tiers it costs money. Per-person limits (5 codes per hour per address) don't stop the *service as a whole* from overspending. Someone cycling through many addresses could.

## Decision
1. **Data providers (ingestion): `apps/api/src/ingest/budget.ts`.**
   - Every request first reserves one unit from a per-source **hourly budget** kept in Postgres (`api_usage`). The reservation is atomic and shared across processes and restarts.
   - Requests from one process are spaced at least **1 second** apart.
   - **Congress.gov** documents 5,000 requests per hour per key (official README, checked 2026-11-10). We allow ourselves **500 per hour** (10%). Configuration can never raise this above 2,500 (50%).
   - When the budget runs out, the run **stops cleanly**: everything processed so far is kept, and the next run resumes where it stopped.
   - A provider **HTTP 429** stops the run immediately, with no retry loop.
2. **Ingestion size: development syncs only a sample.**
   - Outside production, a run takes at most **25 bills** from the last **3 days**.
   - In production the defaults are 500 bills per run and a 7-day first lookback.
   - Override with `INGEST_MAX_BILLS_PER_RUN`, `INGEST_LOOKBACK_DAYS` and `CONGRESS_REQUESTS_PER_HOUR`.
3. **Message providers (vault): `apps/vault/src/providers/outbound-cap.ts`.**
   - Every email or SMS reserves one unit from **service-wide hourly and daily caps** (`outbound_usage`; counts only, no addresses).
   - **Email:** 20 per hour and 80 per day by default. Resend's free plan allows 100 per day.
   - **SMS:** 5 per hour and 20 per day by default, for the Twilio trial.
   - Over a cap, the person sees "too many codes, try again later" (HTTP 429). Nothing is sent and nothing is counted.
   - The development console sender is not capped, because it sends nothing.
4. **Not-yet-integrated providers.** Open States and CourtListener get a budget only once their published limits have been checked against their own documentation. Until then, no code calls them.

## Consequences
- Our keys stay well inside provider limits, even under abuse or misconfiguration.
- Under heavy legitimate demand, sign-ups may briefly see "try again later". Raise the caps, within the provider's plan, when that happens.
- Budgets are per clock hour, so a burst at the end of one hour and the start of the next can use two hours' worth of budget. That is still far below the provider limits above.
