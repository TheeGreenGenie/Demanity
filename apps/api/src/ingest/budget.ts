import type { Pool } from '@demanity/db';

/**
 * Outbound API budget (docs/adr/0008-outbound-api-budgets.md).
 *
 * Before every request to a data provider we:
 *  1. reserve one request from a per-source hourly budget stored in Postgres
 *     (atomic; shared across processes and restarts), and
 *  2. wait so consecutive requests are at least `minIntervalMs` apart.
 * When the hour's budget is spent, `take()` throws BudgetExhausted and the
 * sync stops cleanly, resuming next run. A provider "429 Too Many Requests"
 * stops the run too (no retry loop that could hammer the provider).
 */

export class BudgetExhausted extends Error {
  constructor(readonly source: string) {
    super(`${source}: hourly request budget used up; will resume next run`);
  }
}

export class ProviderRateLimited extends Error {
  constructor(readonly source: string) {
    super(`${source}: provider returned 429 Too Many Requests; stopping this run`);
  }
}

export interface BudgetOptions {
  /** Max requests we allow ourselves per clock hour (keep well below the provider's limit). */
  perHour: number;
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

  async take(): Promise<void> {
    const { rows } = await this.pool.query<{ requests: number }>(
      `INSERT INTO api_usage (source, window_start, requests)
       VALUES ($1, date_trunc('hour', now()), 1)
       ON CONFLICT (source, window_start) DO UPDATE SET requests = api_usage.requests + 1
         WHERE api_usage.requests < $2
       RETURNING requests`,
      [this.source, this.opts.perHour],
    );
    if (rows.length === 0) throw new BudgetExhausted(this.source);
    const wait = this.lastAt + this.opts.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastAt = this.now();
  }

  /** Requests used in the current hour (for logs and the freshness endpoint). */
  async usedThisHour(): Promise<number> {
    const { rows } = await this.pool.query<{ requests: number }>(
      "SELECT requests FROM api_usage WHERE source = $1 AND window_start = date_trunc('hour', now())",
      [this.source],
    );
    return rows[0]?.requests ?? 0;
  }
}

/**
 * Defaults. Congress.gov documents 5,000 requests/hour per key
 * (github.com/LibraryOfCongress/api.congress.gov README, checked 2026-11-10);
 * we allow ourselves 10% of that and at most one request per second.
 */
export const CONGRESS_BUDGET: BudgetOptions = { perHour: 500, minIntervalMs: 1000 };

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
    congressPerHour: Math.min(num('CONGRESS_REQUESTS_PER_HOUR', CONGRESS_BUDGET.perHour), 2500),
  };
}
