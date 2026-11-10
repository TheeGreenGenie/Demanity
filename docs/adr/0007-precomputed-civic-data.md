# ADR 0007: Precompute civic data once, serve the same answer to everyone

- **Status:** Accepted (2026-11-10)
- **Requirements:** R12, R13, R32 (and keeping a not-for-profit's server bill small)

## Context
Place and leader pages show a lot of derived numbers:
- 0-100 scores in up to 32 categories;
- each score's rank among peers and the peer average;
- an overall score and its rank;
- quality-of-life peer medians and a "monthly basics" cost figure.

With real data there will be about 3,100 counties, more than 19,000 incorporated places and thousands of officials. Computing ranks and medians on every page view would repeat the same work for every visitor. The data only changes when an ingestion job runs, which happens at most a few times a day.

## Decision
1. **Compute once per data change.** `recomputeRollups()` (`apps/api/src/civic/rollups.ts`) runs after every data load: ingestion jobs, the dev seed, and the sample-data cleanup. It:
   - assigns each place a peer group from its kind and population band;
   - marks which category scores apply at that level of government;
   - writes per-category peer rank, peer count and peer average into `category_scores`;
   - writes overall scores and their ranks into `score_rollups`;
   - writes quality-of-life peer medians and the monthly-basics figure into `place_stats` and `place_cost_rollups`.

   The job is a few set-based SQL statements plus one sort per peer group, so it is O(n log n) in the number of subjects.
2. **Requests only look things up.** Page endpoints read the stored values. No ranking, averaging or median runs at request time.
3. **One response for everyone.** Place, leader, score and guide pages are identical for every viewer. They are built once per data version and kept in an in-memory cache (`apps/api/src/cache.ts`). It holds at most 2,000 entries and evicts the least recently used.
   - Anything personal ("you follow this", "you voted") comes from separate small endpoints, so it never breaks this sharing.
   - Each API instance checks the shared `data_version` at most every 10 seconds, so a cache hit usually costs no database query.
4. **Let the network help.** Cached responses carry `Cache-Control: public, max-age=60, stale-while-revalidate=600` and an `ETag`.
   - A browser or CDN can reuse them.
   - A client that already has the current version gets an empty `304 Not Modified`.
   - A CDN in front of the API can therefore serve most place and leader traffic without reaching our servers at all.
5. **Invalidation is one number.** Every recompute bumps `data_version`. Old cache entries simply stop matching. There is no per-key invalidation logic to get wrong.

## Consequences
- **Cost:** page views cost roughly a cache lookup. The expensive work happens once per data change, not once per visitor.
- **Freshness:** after a data load, a visitor may see the previous numbers for up to about 70 seconds (10 seconds for the version check plus 60 seconds of HTTP cache). This is acceptable for statistics that change at most daily.
- **Memory:** about 2,000 cached JSON bodies per API instance. Place pages are a few kilobytes each, so this is tens of megabytes at most.
- **Discipline:** a cached route must never include viewer-specific data. Code review must check this; the route comments say so.

## Alternatives considered
- **Compute per request with database indexes.** Simplest, but the repeated window functions over peer groups scale with traffic instead of with data changes.
- **Redis as a shared response cache.** Useful once there are many API instances. Deferred, because the in-process cache plus a CDN covers the MVP, and the cache interface allows adding Redis later.
- **Materialized views.** These would also work. The explicit rollup job was chosen because it also runs the evidence-weighted overall formula, which is clearer in TypeScript than in SQL, and it can be unit-tested.
