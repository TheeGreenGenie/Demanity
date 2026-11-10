import type { Pool } from '@demanity/db';
import { BudgetExhausted, isTransient, ProviderRateLimited, type ApiBudget } from './budget.js';
import { statusFromAction } from './congress.js';
import { topicFromSubjects } from './subjects.js';

/**
 * Open States v3 state-bill ingestion for the 5 MVP states (R23, R30).
 *
 * API facts used here, checked 2026-11-10 in Open States' own docs and
 * open-source server (github.com/openstates/api-v3):
 * - Base https://v3.openstates.org, key in the `X-API-KEY` header.
 * - GET /bills requires `jurisdiction` (or `q`); supports `updated_since`,
 *   `sort` (`updated_asc`, `updated_desc`, ...), `include` (`sponsorships`,
 *   `abstracts`, ...), `page`, `per_page` (max 20 for bills).
 * - Response { results: Bill[], pagination: { per_page, page, max_page, total_items } }.
 * - Bill fields: id, session, jurisdiction, identifier, title, openstates_url,
 *   first_action_date, latest_action_date, latest_action_description,
 *   updated_at, abstracts[{abstract}], sponsorships[{name, primary,
 *   classification, person{id, name, party, current_role{title,
 *   org_classification, district}}}].
 * - Default key tier: 10 requests/minute, 250/day (api/auth.py). Our budget
 *   is half of that (budget.ts).
 */

export const SOURCE = 'openstates';
const BASE = 'https://v3.openstates.org';

export interface OSBill {
  id: string;
  session: string;
  identifier: string;
  title: string;
  openstates_url: string;
  first_action_date?: string | null;
  latest_action_date?: string | null;
  latest_action_description?: string | null;
  updated_at: string;
  abstracts?: Array<{ abstract: string }>;
  /** The state's own subject tags (a default Bill field in Open States v3). */
  subject?: string[];
  sponsorships?: Array<{
    name: string;
    primary: boolean;
    classification: string;
    person?: {
      id: string;
      name: string;
      party?: string;
      current_role?: { title?: string; org_classification?: string; district?: string } | null;
    } | null;
  }>;
}

export class OpenStatesClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly budget: ApiBudget | null = null,
  ) {
    if (!apiKey) throw new Error('An Open States API key is required');
  }

  async bills(jurisdiction: string, updatedSince: Date, page: number) {
    const url = new URL(`${BASE}/bills`);
    url.searchParams.set('jurisdiction', jurisdiction);
    url.searchParams.set('updated_since', updatedSince.toISOString().slice(0, 19));
    url.searchParams.set('sort', 'updated_asc');
    url.searchParams.append('include', 'sponsorships');
    url.searchParams.append('include', 'abstracts');
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '20');
    await this.budget?.take();
    const res = await this.fetchFn(url.toString(), { headers: { 'X-API-KEY': this.apiKey } });
    if (isTransient(res.status)) throw new ProviderRateLimited(SOURCE, res.status);
    if (!res.ok) throw new Error(`Open States /bills failed: HTTP ${res.status}`);
    return (await res.json()) as {
      results: OSBill[];
      pagination: { page: number; max_page: number; total_items: number };
    };
  }
}

/** Our state slugs and the jurisdiction names Open States accepts. */
export const MVP_STATES: Record<string, string> = {
  california: 'California',
  texas: 'Texas',
  florida: 'Florida',
  'new-york': 'New York',
  pennsylvania: 'Pennsylvania',
};

const PARTY: Record<string, string> = {
  Democratic: 'Democratic',
  Republican: 'Republican',
  Independent: 'Independent',
};

export interface StateSyncResult {
  bills: number;
  leaders: number;
  stoppedEarly: string | null;
}

/**
 * Syncs recently updated bills for each MVP state: up to `pagesPerState`
 * pages of 20, oldest update first, resuming from each state's cursor.
 */
export async function syncStateBills(
  pool: Pool,
  client: OpenStatesClient,
  opts: {
    now?: Date;
    pagesPerState?: number;
    defaultLookbackDays?: number;
    states?: string[];
  } = {},
): Promise<StateSyncResult> {
  const now = opts.now ?? new Date();
  const pages = opts.pagesPerState ?? 1;
  let bills = 0;
  let leaders = 0;
  let stoppedEarly: string | null = null;
  const { rows: subjectMap } = await pool.query<{ keyword: string; category_slug: string }>(
    'SELECT keyword, category_slug FROM subject_category_map',
  );
  const { rows: topicRows } = await pool.query<{ id: string; slug: string }>(
    "SELECT id, slug FROM communities WHERE kind = 'topic'",
  );
  const topicId = new Map(topicRows.map((t) => [t.slug, t.id]));

  for (const slug of opts.states ?? Object.keys(MVP_STATES)) {
    const source = `${SOURCE}:${slug}`;
    const { rows: place } = await pool.query<{ id: string }>(
      'SELECT id FROM places WHERE slug = $1',
      [slug],
    );
    if (!place[0]) continue;
    const { rows: state } = await pool.query<{ synced_through: Date | null }>(
      'SELECT synced_through FROM sync_state WHERE source = $1',
      [source],
    );
    const from =
      state[0]?.synced_through ??
      new Date(now.getTime() - (opts.defaultLookbackDays ?? 7) * 86_400_000);
    await pool.query(
      `INSERT INTO sync_state (source, last_run_at) VALUES ($1, now())
       ON CONFLICT (source) DO UPDATE SET last_run_at = now()`,
      [source],
    );

    let lastUpdate: string | null = null;
    let complete = false;
    let count = 0;
    try {
      for (let page = 1; page <= pages; page++) {
        const res = await client.bills(MVP_STATES[slug]!, from, page);
        for (const b of res.results) {
          // Sponsors: primary first, at most 3, people only.
          const people = (b.sponsorships ?? [])
            .filter((s) => s.person)
            .sort((a, z) => Number(z.primary) - Number(a.primary))
            .slice(0, 3);
          const ids: Array<[string, boolean]> = [];
          for (const s of people) {
            const p = s.person!;
            const upper = p.current_role?.org_classification === 'upper';
            const lslug = `${p.name}-${p.id.slice(-8)}`
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 80);
            const { rows } = await pool.query<{ id: string; inserted: boolean }>(
              `INSERT INTO leaders (slug, name, office, office_kind, party, place_id, source, external_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (source, external_id) DO UPDATE
                 SET name = EXCLUDED.name, office = EXCLUDED.office, party = EXCLUDED.party
               RETURNING id, (xmax = 0) AS inserted`,
              [
                lslug,
                p.name,
                `${p.current_role?.title ?? (upper ? 'Senator' : 'Representative')}, ${MVP_STATES[slug]}${p.current_role?.district ? ` District ${p.current_role.district}` : ''}`,
                upper ? 'state_senate' : 'state_house',
                PARTY[p.party ?? ''] ?? p.party ?? '',
                place[0].id,
                SOURCE,
                p.id,
              ],
            );
            if (rows[0]!.inserted) leaders++;
            ids.push([rows[0]!.id, s.primary]);
          }
          const day = (d?: string | null) => (d ? d.slice(0, 10) : null);
          const { rows: saved } = await pool.query<{ id: string }>(
            `INSERT INTO bills (place_id, number, title, summary, status, introduced_at, last_action_at,
                               source_url, source, external_id, latest_action_text, source_updated_at, fetched_at,
                               subjects, category_id, category_auto)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13, $14::uuid, $14::uuid IS NOT NULL)
             ON CONFLICT (source, external_id) DO UPDATE
               SET title = EXCLUDED.title, summary = EXCLUDED.summary, status = EXCLUDED.status,
                   subjects = EXCLUDED.subjects, category_id = EXCLUDED.category_id,
                   category_auto = EXCLUDED.category_auto,
                   last_action_at = EXCLUDED.last_action_at, latest_action_text = EXCLUDED.latest_action_text,
                   source_updated_at = EXCLUDED.source_updated_at, fetched_at = now()
             RETURNING id`,
            [
              place[0].id,
              `${b.identifier} (${b.session})`,
              b.title,
              b.abstracts?.[0]?.abstract ?? '',
              statusFromAction(b.latest_action_description ?? ''),
              day(b.first_action_date) ?? b.updated_at.slice(0, 10),
              day(b.latest_action_date) ?? b.updated_at.slice(0, 10),
              b.openstates_url,
              SOURCE,
              b.id,
              b.latest_action_description ?? '',
              b.updated_at,
              b.subject ?? [],
              topicId.get(topicFromSubjects(b.subject ?? [], subjectMap) ?? '') ?? null,
            ],
          );
          for (const [leaderId, primary] of ids)
            await pool.query(
              `INSERT INTO bill_sponsors (bill_id, leader_id, role) VALUES ($1, $2, $3)
               ON CONFLICT (bill_id, leader_id) DO NOTHING`,
              [saved[0]!.id, leaderId, primary ? 'sponsor' : 'cosponsor'],
            );
          count++;
          lastUpdate = b.updated_at;
        }
        if (page >= res.pagination.max_page) {
          complete = true;
          break;
        }
      }
    } catch (err) {
      if (err instanceof BudgetExhausted || err instanceof ProviderRateLimited) {
        stoppedEarly = err.message;
      } else {
        await pool.query('UPDATE sync_state SET last_error = $2 WHERE source = $1', [
          source,
          (err as Error).message.slice(0, 500),
        ]);
        throw err;
      }
    }
    await pool.query(
      `UPDATE sync_state SET last_success_at = now(), last_error = NULL, items_last_run = $2,
              synced_through = COALESCE($3::timestamptz, synced_through)
        WHERE source = $1`,
      [source, count, complete ? now : lastUpdate ? new Date(lastUpdate) : null],
    );
    bills += count;
    if (stoppedEarly) break; // don't keep calling once the budget says stop
  }
  if (bills > 0) await pool.query('UPDATE data_version SET dirty = true');
  return { bills, leaders, stoppedEarly };
}
