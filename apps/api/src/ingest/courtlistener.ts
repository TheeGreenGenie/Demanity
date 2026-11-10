import type { Pool } from '@demanity/db';
import { BudgetExhausted, isTransient, ProviderRateLimited, type ApiBudget } from './budget.js';

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
 * - `type=d` returns PACER dockets (case filings) and, unlike opinions, is
 *   current (live check: cacd filings dated the same day).
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
  court_citation_string?: string;
  dateFiled: string;
  absolute_url: string;
  docketNumber?: string | null;
  cluster_id: number;
}

/**
 * Docket (case filing) search result, `type=d`. Field names from a live
 * response on 2026-11-10. We store only the case caption, number, court,
 * dates, cause and nature of suit; never `party`, `attorney` or `firm`.
 */
export interface CLDocket {
  caseName: string;
  court_id: string;
  court_citation_string?: string;
  dateFiled: string;
  docketNumber?: string | null;
  docket_id: number;
  docket_absolute_url: string;
  cause?: string | null;
  suitNature?: string | null;
}

/** Bluebook court abbreviations, used if a result lacks court_citation_string. */
export const COURT_CITATIONS: Record<string, string> = {
  cacd: 'C.D. Cal.',
  txsd: 'S.D. Tex.',
  flsd: 'S.D. Fla.',
  nyed: 'E.D.N.Y.',
  paed: 'E.D. Pa.',
};

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

  /** Newest first. `type=o`: case-law opinions; `type=d`: PACER dockets (case filings). */
  private async search<T>(type: 'o' | 'd', courtId: string) {
    const url = new URL(`${BASE}/search/`);
    url.searchParams.set('type', type);
    url.searchParams.set('order_by', 'dateFiled desc');
    url.searchParams.set('q', `court_id:${courtId}`);
    await this.budget?.take();
    const res = await this.fetchFn(url.toString(), {
      headers: { Authorization: `Token ${this.token}` },
    });
    if (isTransient(res.status)) throw new ProviderRateLimited(SOURCE, res.status);
    if (!res.ok) throw new Error(`CourtListener search failed: HTTP ${res.status}`);
    return (await res.json()) as { count?: number; results: T[] };
  }

  latestOpinions(courtId: string) {
    return this.search<CLOpinion>('o', courtId);
  }

  latestDockets(courtId: string) {
    return this.search<CLDocket>('d', courtId);
  }
}

const BLUEBOOK_MONTHS = [
  'Jan.',
  'Feb.',
  'Mar.',
  'Apr.',
  'May',
  'June',
  'July',
  'Aug.',
  'Sept.',
  'Oct.',
  'Nov.',
  'Dec.',
];

/**
 * Citation in Bluebook style, e.g.
 *   "Doe v. Roe, No. 2:26-cv-1 (C.D. Cal. filed Nov. 10, 2026)"  (case filing)
 *   "Doe v. Roe, No. 2:19-cv-1 (C.D. Cal. Aug. 1, 2019)"        (opinion)
 */
export function caseCitation(c: {
  caseName: string;
  docketNumber: string;
  courtCitation: string;
  date: string; // YYYY-MM-DD
  filed: boolean;
}): string {
  const [y, m, d] = c.date.split('-').map(Number);
  const when = `${BLUEBOOK_MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
  const number = c.docketNumber.replace(/^(case\s+)?no\.?\s*/i, '');
  return `${c.caseName}${number ? `, No. ${number}` : ''} (${[c.courtCitation, c.filed ? 'filed' : '', when].filter(Boolean).join(' ')})`;
}

export interface RulingsSyncResult {
  rulings: number;
  dockets: number;
  stoppedEarly: string | null;
}

/**
 * Per court: one search for the latest opinions and one for the newest case
 * filings (2 requests), keeping at most `perCourt` of each.
 */
export async function syncRulings(
  pool: Pool,
  client: CourtListenerClient,
  opts: { now?: Date; perCourt?: number } = {},
): Promise<RulingsSyncResult> {
  const now = opts.now ?? new Date();
  if (inMaintenanceWindow(now))
    return {
      rulings: 0,
      dockets: 0,
      stoppedEarly: 'CourtListener weekly maintenance window; skipped',
    };
  await pool.query(
    `INSERT INTO sync_state (source, last_run_at) VALUES ($1, now())
     ON CONFLICT (source) DO UPDATE SET last_run_at = now()`,
    [SOURCE],
  );
  const keep = opts.perCourt ?? 5;
  let rulings = 0;
  let dockets = 0;
  let stoppedEarly: string | null = null;
  try {
    for (const courtId of Object.values(COURT_IDS)) {
      const cite = (x: { court_citation_string?: string }) =>
        x.court_citation_string || COURT_CITATIONS[courtId] || '';

      const filings = await client.latestDockets(courtId);
      for (const d of filings.results.slice(0, keep)) {
        await pool.query(
          `INSERT INTO court_dockets (source, external_id, court_id, court_citation, case_name, docket_number,
                                      date_filed, cause, nature_of_suit, url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (source, external_id) DO UPDATE
             SET case_name = EXCLUDED.case_name, cause = EXCLUDED.cause,
                 nature_of_suit = EXCLUDED.nature_of_suit, fetched_at = now()`,
          [
            SOURCE,
            String(d.docket_id),
            d.court_id || courtId,
            cite(d),
            d.caseName,
            d.docketNumber ?? '',
            d.dateFiled.slice(0, 10),
            d.cause ?? '',
            d.suitNature ?? '',
            new URL(d.docket_absolute_url, SITE).toString(),
          ],
        );
        dockets++;
      }

      const opinions = await client.latestOpinions(courtId);
      for (const o of opinions.results.slice(0, keep)) {
        await pool.query(
          `INSERT INTO court_rulings (source, external_id, court_id, court_citation, case_name, docket_number, date_filed, url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (source, external_id) DO UPDATE
             SET case_name = EXCLUDED.case_name, date_filed = EXCLUDED.date_filed,
                 court_citation = EXCLUDED.court_citation, fetched_at = now()`,
          [
            SOURCE,
            String(o.cluster_id),
            o.court_id || courtId,
            cite(o),
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
    [SOURCE, rulings + dockets, stoppedEarly === null, now],
  );
  return { rulings, dockets, stoppedEarly };
}
