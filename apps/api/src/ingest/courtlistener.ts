import type { Pool } from '@demanity/db';
import { BudgetExhausted, ProviderRateLimited, type ApiBudget } from './budget.js';

/**
 * Recent federal district-court opinions from CourtListener (R23, R32), for
 * court-district pages.
 *
 * API facts used here, checked 2026-11-10 in CourtListener's docs
 * (wiki.free.law/c/courtlistener/help/api/...):
 * - Base https://www.courtlistener.com/api/rest/v4/, header
 *   `Authorization: Token <token>`.
 * - GET /search/?type=o&q=... searches case-law opinions; results in
 *   `results` with caseName, court, court_id, dateFiled, absolute_url,
 *   docketNumber, cluster_id; `next` is a cursor URL.
 * - Query operators: `court_id:cacd`, `dateFiled:[2026-11-01 TO *]` (ISO dates, uppercase TO).
 * - `order_by=dateFiled desc` is one of the opinion sort values
 *   (freelawproject/courtlistener, cl/search/forms.py OPINION_ORDER_BY_CHOICES).
 * - Coverage: a live check on 2026-11-10 found CourtListener's newest cacd
 *   opinion is from 2019-08-01 (4,936 in total). So we take the latest
 *   opinions available, newest first, with no date filter, and the page shows
 *   each date plus a coverage note. Nothing is presented as recent.
 * - Court IDs: cacd, txsd, flsd, nyed, paed (CourtListener jurisdictions page).
 * - Limits: 5/minute, 50/hour, 125/day, all at once. Weekly maintenance
 *   Thursdays 21:00-23:59 Pacific; we don't call during it.
 */

export const SOURCE = 'courtlistener';
const BASE = 'https://www.courtlistener.com/api/rest/v4';
const SITE = 'https://www.courtlistener.com';

/** Our court-district place slugs → CourtListener court IDs. */
export const COURT_IDS: Record<string, string> = {
  'cd-cal': 'cacd',
  'sd-tex': 'txsd',
  'sd-fla': 'flsd',
  'ed-ny': 'nyed',
  'ed-pa': 'paed',
};

export interface CLOpinion {
  caseName: string;
  court_id: string;
  dateFiled: string;
  absolute_url: string;
  docketNumber?: string | null;
  cluster_id: number;
}

/** True during CourtListener's weekly maintenance (Thu 21:00-23:59 Pacific). */
export function inMaintenanceWindow(at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return weekday === 'Thu' && hour >= 21;
}

export class CourtListenerClient {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly budget: ApiBudget | null = null,
  ) {
    if (!token) throw new Error('A CourtListener API token is required');
  }

  async latestOpinions(courtId: string) {
    const url = new URL(`${BASE}/search/`);
    url.searchParams.set('type', 'o');
    url.searchParams.set('order_by', 'dateFiled desc');
    url.searchParams.set('q', `court_id:${courtId}`);
    await this.budget?.take();
    const res = await this.fetchFn(url.toString(), {
      headers: { Authorization: `Token ${this.token}` },
    });
    if (res.status === 429) throw new ProviderRateLimited(SOURCE);
    if (!res.ok) throw new Error(`CourtListener search failed: HTTP ${res.status}`);
    return (await res.json()) as { count?: number; results: CLOpinion[] };
  }
}

export interface RulingsSyncResult {
  rulings: number;
  stoppedEarly: string | null;
}

/** One search request per court; keeps at most `perCourt` opinions each. */
export async function syncRulings(
  pool: Pool,
  client: CourtListenerClient,
  opts: { now?: Date; perCourt?: number } = {},
): Promise<RulingsSyncResult> {
  const now = opts.now ?? new Date();
  if (inMaintenanceWindow(now))
    return { rulings: 0, stoppedEarly: 'CourtListener weekly maintenance window; skipped' };
  await pool.query(
    `INSERT INTO sync_state (source, last_run_at) VALUES ($1, now())
     ON CONFLICT (source) DO UPDATE SET last_run_at = now()`,
    [SOURCE],
  );
  let rulings = 0;
  let stoppedEarly: string | null = null;
  try {
    for (const courtId of Object.values(COURT_IDS)) {
      const res = await client.latestOpinions(courtId);
      for (const o of res.results.slice(0, opts.perCourt ?? 5)) {
        await pool.query(
          `INSERT INTO court_rulings (source, external_id, court_id, case_name, docket_number, date_filed, url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (source, external_id) DO UPDATE
             SET case_name = EXCLUDED.case_name, date_filed = EXCLUDED.date_filed, fetched_at = now()`,
          [
            SOURCE,
            String(o.cluster_id),
            o.court_id || courtId,
            o.caseName,
            o.docketNumber ?? '',
            o.dateFiled.slice(0, 10),
            new URL(o.absolute_url, SITE).toString(),
          ],
        );
        rulings++;
      }
    }
  } catch (err) {
    if (err instanceof BudgetExhausted || err instanceof ProviderRateLimited)
      stoppedEarly = err.message;
    else {
      await pool.query('UPDATE sync_state SET last_error = $2 WHERE source = $1', [
        SOURCE,
        (err as Error).message.slice(0, 500),
      ]);
      throw err;
    }
  }
  await pool.query(
    `UPDATE sync_state SET last_success_at = now(), last_error = NULL, items_last_run = $2,
            synced_through = CASE WHEN $3::boolean THEN $4::timestamptz ELSE synced_through END
      WHERE source = $1`,
    [SOURCE, rulings, stoppedEarly === null, now],
  );
  return { rulings, stoppedEarly };
}
