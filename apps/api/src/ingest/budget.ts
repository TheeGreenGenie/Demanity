import type { Pool } from '@demanity/db';

/**
 * Outbound API budget (docs/adr/0008-outbound-api-budgets.md).
 *
 * Before every request to a data provider we:
 *  1. reserve one request in every configured window (minute, hour, day),
 *     atomically in Postgres, shared across processes and restarts; if any
 *     window is full nothing is counted and BudgetExhausted is thrown;
 *  2. wait so consecutive requests are at least `minIntervalMs` apart.
 * A provider "429 Too Many Requests" stops the run too (no retry loop).
 */

export class BudgetExhausted extends Error {
  constructor(
    readonly source: string,
    readonly window: Window = 'hour',
  ) {
    super(`${source}: ${window}ly request budget used up; will resume next run`);
  }
}

/**
 * The provider asked us to slow down (429) or is temporarily unavailable
 * (502/503/504). Either way: stop this run, keep what was saved, no retries.
 */
export class ProviderRateLimited extends Error {
  constructor(
    readonly source: string,
    readonly status = 429,
  ) {
    super(
      status === 429
        ? `${source}: provider returned 429 Too Many Requests; stopping this run`
        : `${source}: provider temporarily unavailable (HTTP ${status}); will resume next run`,
    );
  }
}

/** Statuses that mean "stop for now and try again next run". */
export const isTransient = (status: number) => status === 429 || (status >= 502 && status <= 504);

export type Window = 'minute' | 'hour' | 'day';

export interface BudgetOptions {
  perMinute?: number;
  perHour?: number;
  perDay?: number;
  /** Minimum gap between consecutive requests from this process. */
  minIntervalMs: number;
}

export class ApiBudget {
  private lastAt = 0;

  constructor(
    private readonly pool: Pool,
    readonly source: string,
    readonly opts: BudgetOptions,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = Date.now,
  ) {}

  private windows(): Array<[Window, number]> {
    const w: Array<[Window, number]> = [];
    if (this.opts.perMinute) w.push(['minute', this.opts.perMinute]);
    if (this.opts.perHour) w.push(['hour', this.opts.perHour]);
    if (this.opts.perDay) w.push(['day', this.opts.perDay]);
    return w;
  }

  async take(): Promise<void> {
    // Wait first, then reserve, so the reservation lands in the window the
    // request is actually sent in.
    const wait = this.lastAt + this.opts.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [kind, limit] of this.windows()) {
        const { rows } = await client.query(
          `INSERT INTO api_usage (source, window_kind, window_start, requests)
           VALUES ($1, $2, date_trunc($2, now()), 1)
           ON CONFLICT (source, window_kind, window_start)
             DO UPDATE SET requests = api_usage.requests + 1 WHERE api_usage.requests < $3
           RETURNING requests`,
          [this.source, kind, limit],
        );
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          throw new BudgetExhausted(this.source, kind);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    this.lastAt = this.now();
  }

  /** Requests used in the current window (for logs). */
  async used(kind: Window = 'hour'): Promise<number> {
    const { rows } = await this.pool.query<{ requests: number }>(
      'SELECT requests FROM api_usage WHERE source = $1 AND window_kind = $2 AND window_start = date_trunc($2, now())',
      [this.source, kind],
    );
    return rows[0]?.requests ?? 0;
  }

  /** @deprecated use used('hour') */
  usedThisHour(): Promise<number> {
    return this.used('hour');
  }
}

/**
 * Budgets, each about half (or less) of the provider's published limit.
 * Sources, all checked 2026-11-10:
 * - Congress.gov: 5,000 requests/hour per key (LibraryOfCongress/api.congress.gov README).
 * - Open States v3 default tier: 10/minute, 250/day (openstates/api-v3, api/auth.py
 *   `Tier("default", 10, 0, 250)` with fields per_minute, per_hour, per_day in api/rate_limiter.py).
 * - CourtListener v4: 5/minute, 50/hour, 125/day, all enforced at once
 *   (wiki.free.law/c/courtlistener/help/api/rest/v4/overview).
 */
export const CONGRESS_BUDGET: BudgetOptions = { perHour: 500, minIntervalMs: 1000 };
export const OPENSTATES_BUDGET: BudgetOptions = {
  perMinute: 5,
  perDay: 120,
  minIntervalMs: 12_000,
};
/** Federal Register: no published limit and no key; one request per run, gently capped. */
export const FEDERALREGISTER_BUDGET: BudgetOptions = {
  perMinute: 10,
  perHour: 60,
  minIntervalMs: 2000,
};
export const COURTLISTENER_BUDGET: BudgetOptions = {
  perMinute: 2,
  perHour: 25,
  perDay: 60,
  minIntervalMs: 30_000,
};

/**
 * How much to ingest per run. Outside production we only want a sample of
 * real data, not everything, so runs are small.
 */
export function ingestCaps(nodeEnv: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  const prod = nodeEnv === 'production';
  const num = (name: string, fallback: number) => {
    const v = Number(env[name]);
    return Number.isInteger(v) && v > 0 ? v : fallback;
  };
  return {
    maxBillsPerRun: num('INGEST_MAX_BILLS_PER_RUN', prod ? 500 : 25),
    lookbackDays: num('INGEST_LOOKBACK_DAYS', prod ? 7 : 3),
    congressPerHour: Math.min(num('CONGRESS_REQUESTS_PER_HOUR', CONGRESS_BUDGET.perHour!), 2500),
    /** Open States: pages of 20 bills per state per run (1 request each). */
    statePagesPerRun: prod ? 3 : 1,
    /** CourtListener: rulings kept per court per run (1 search request per court). */
    rulingsPerCourt: prod ? 20 : 5,
  };
}
