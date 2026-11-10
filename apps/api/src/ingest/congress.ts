import type { Pool } from '@demanity/db';

/**
 * Congress.gov bill ingestion (R23, R30; docs/LEGISLATION.md).
 *
 * API facts used here, checked on 2026-11-10 against the official docs
 * (github.com/LibraryOfCongress/api.congress.gov) and live responses:
 * - Base https://api.congress.gov/v3, key in the `api_key` query parameter,
 *   `format=json`, `limit` up to 250, `offset` for paging, 5,000 requests/hour.
 * - GET /bill?fromDateTime=…&toDateTime=…&sort=updateDate+asc lists bills by
 *   update time: { bills: [{ congress, type, number, title, latestAction:
 *   { actionDate, text }, updateDate, url, ... }], pagination: { count, next } }.
 * - GET /bill/{congress}/{type}/{number} returns { bill: { introducedDate,
 *   policyArea: { name }, sponsors: [{ bioguideId, fullName, firstName,
 *   lastName, party, state, district? }], latestAction, ... } }.
 *
 * The sync is idempotent (upserts on source + external id) and incremental:
 * it resumes from sync_state.synced_through, and only advances that cursor
 * after a complete, successful run.
 */

export const SOURCE = 'congress.gov';
const BASE = 'https://api.congress.gov/v3';

export interface CongressListItem {
  congress: number;
  type: string;
  number: string;
  title: string;
  latestAction?: { actionDate: string; text: string };
  updateDate: string;
}

export interface CongressBillDetail {
  congress: number;
  type: string;
  number: string;
  title: string;
  introducedDate?: string;
  policyArea?: { name: string } | null;
  latestAction?: { actionDate: string; text: string };
  updateDate: string;
  sponsors?: Array<{
    bioguideId: string;
    fullName: string;
    firstName?: string;
    lastName?: string;
    party?: string;
    state?: string;
    district?: number;
  }>;
}

export class CongressClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error('A Congress.gov (api.data.gov) API key is required');
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries({ ...params, format: 'json' })) url.searchParams.set(k, v);
    url.searchParams.set('api_key', this.apiKey);
    const res = await this.fetchFn(url.toString());
    // Never include the URL (it carries the key) in errors or logs.
    if (!res.ok) throw new Error(`Congress.gov ${path} failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  listUpdated(from: Date, to: Date, offset: number, limit = 250) {
    return this.get<{ bills: CongressListItem[]; pagination?: { next?: string } }>('/bill', {
      fromDateTime: iso(from),
      toDateTime: iso(to),
      sort: 'updateDate asc',
      offset: String(offset),
      limit: String(limit),
    });
  }

  bill(congress: number, type: string, number: string) {
    return this.get<{ bill: CongressBillDetail }>(
      `/bill/${congress}/${type.toLowerCase()}/${encodeURIComponent(number)}`,
    );
  }
}

/** Congress.gov wants second precision: 2026-11-09T00:00:00Z. */
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

const TYPE_LABEL: Record<string, [string, string]> = {
  HR: ['H.R.', 'house-bill'],
  S: ['S.', 'senate-bill'],
  HRES: ['H.Res.', 'house-resolution'],
  SRES: ['S.Res.', 'senate-resolution'],
  HJRES: ['H.J.Res.', 'house-joint-resolution'],
  SJRES: ['S.J.Res.', 'senate-joint-resolution'],
  HCONRES: ['H.Con.Res.', 'house-concurrent-resolution'],
  SCONRES: ['S.Con.Res.', 'senate-concurrent-resolution'],
};

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** Display number, e.g. "H.R. 1" (the congress is kept in external_id). */
export const displayNumber = (type: string, number: string) =>
  `${TYPE_LABEL[type.toUpperCase()]?.[0] ?? type.toUpperCase()} ${number}`;

/** Public page for citations, e.g. https://www.congress.gov/bill/119th-congress/house-bill/1 */
export const publicUrl = (congress: number, type: string, number: string) =>
  `https://www.congress.gov/bill/${ordinal(congress)}-congress/${TYPE_LABEL[type.toUpperCase()]?.[1] ?? type.toLowerCase()}/${number}`;

export const externalId = (congress: number, type: string, number: string) =>
  `us:${congress}:${type.toLowerCase()}:${number}`;

/**
 * Status from the latest action text. Heuristic, documented in
 * docs/LEGISLATION.md; checked in order, first match wins.
 */
export function statusFromAction(text: string): string {
  const t = text.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/became (public|private) law|signed by (the )?president/, 'signed'],
    [/vetoed|veto message/, 'vetoed'],
    [/failed of passage|failed to pass|not agreed to/, 'failed'],
    [/presented to (the )?president|cleared for (the )?white house/, 'passed'],
    [
      /passed (the )?(house|senate)|passed\/agreed to in|agreed to in (the )?(house|senate)/,
      'passed_chamber',
    ],
    [/referred to|committee|reported by|placed on .*calendar/, 'in_committee'],
  ];
  return rules.find(([re]) => re.test(t))?.[1] ?? 'introduced';
}

/** "Economics and Public Finance" (Congress.gov) ↔ "Economics & Public Finance" (ours). */
export const normalizeArea = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z]+/g, ' ')
    .trim();

const PARTY: Record<string, string> = { R: 'Republican', D: 'Democratic', I: 'Independent' };

const STATE_SLUG: Record<string, string> = {
  CA: 'california',
  TX: 'texas',
  FL: 'florida',
  NY: 'new-york',
  PA: 'pennsylvania',
};

export interface SyncResult {
  bills: number;
  leaders: number;
  through: Date;
}

/**
 * Syncs bills updated since the last successful run (or `since`), up to `now`.
 * `maxBills` caps one run so a first sync can be spread over several runs.
 */
export async function syncCongressBills(
  pool: Pool,
  client: CongressClient,
  opts: { now?: Date; since?: Date; maxBills?: number } = {},
): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const { rows: state } = await pool.query<{ synced_through: Date | null }>(
    'SELECT synced_through FROM sync_state WHERE source = $1',
    [SOURCE],
  );
  const from = opts.since ?? state[0]?.synced_through ?? new Date(now.getTime() - 7 * 86_400_000);
  await pool.query(
    `INSERT INTO sync_state (source, last_run_at) VALUES ($1, now())
     ON CONFLICT (source) DO UPDATE SET last_run_at = now()`,
    [SOURCE],
  );

  const { rows: nation } = await pool.query<{ id: string }>(
    "SELECT id FROM places WHERE slug = 'united-states'",
  );
  const { rows: cats } = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM communities WHERE kind = 'topic'",
  );
  const catByName = new Map(cats.map((c) => [normalizeArea(c.name), c.id]));
  const { rows: statePlaces } = await pool.query<{ id: string; slug: string }>(
    "SELECT id, slug FROM places WHERE kind = 'state'",
  );
  const placeBySlug = new Map(statePlaces.map((p) => [p.slug, p.id]));

  let offset = 0;
  let bills = 0;
  let leaders = 0;
  let complete = false;
  let lastUpdate: string | null = null; // updateDate of the last bill processed (ascending)
  const max = opts.maxBills ?? 2000;
  try {
    for (;;) {
      const page = await client.listUpdated(from, now, offset);
      for (const item of page.bills ?? []) {
        if (bills >= max) break;
        const { bill } = await client.bill(item.congress, item.type, item.number);
        // Sponsors become leader rows (real people, no scores until citations exist).
        const sponsorIds: string[] = [];
        for (const s of bill.sponsors ?? []) {
          const house = s.district !== undefined && s.district !== null;
          const name = s.firstName && s.lastName ? `${s.firstName} ${s.lastName}` : s.fullName;
          const slug = `${name}-${s.bioguideId}`
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 80);
          const { rows } = await pool.query<{ id: string; inserted: boolean }>(
            `INSERT INTO leaders (slug, name, office, office_kind, party, place_id, source, external_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (source, external_id) DO UPDATE
               SET name = EXCLUDED.name, office = EXCLUDED.office, office_kind = EXCLUDED.office_kind,
                   party = EXCLUDED.party, place_id = EXCLUDED.place_id
             RETURNING id, (xmax = 0) AS inserted`,
            [
              slug,
              name,
              house
                ? `U.S. Representative, ${s.state ?? ''}-${s.district}`
                : `U.S. Senator, ${s.state ?? ''}`,
              house ? 'us_house' : 'us_senate',
              PARTY[s.party ?? ''] ?? s.party ?? '',
              placeBySlug.get(STATE_SLUG[s.state ?? ''] ?? '') ?? null,
              SOURCE,
              s.bioguideId,
            ],
          );
          if (rows[0]!.inserted) leaders++;
          sponsorIds.push(rows[0]!.id);
        }
        const action = bill.latestAction ?? item.latestAction;
        const { rows: saved } = await pool.query<{ id: string }>(
          `INSERT INTO bills (place_id, number, title, summary, category_id, status, introduced_at,
                             last_action_at, source_url, source, external_id, latest_action_text,
                             source_updated_at, fetched_at)
           VALUES ($1, $2, $3, '', $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
           ON CONFLICT (source, external_id) DO UPDATE
             SET title = EXCLUDED.title, category_id = EXCLUDED.category_id, status = EXCLUDED.status,
                 last_action_at = EXCLUDED.last_action_at, latest_action_text = EXCLUDED.latest_action_text,
                 source_updated_at = EXCLUDED.source_updated_at, fetched_at = now()
           RETURNING id`,
          [
            nation[0]!.id,
            `${displayNumber(item.type, item.number)} (${ordinal(item.congress)})`,
            bill.title ?? item.title,
            bill.policyArea?.name
              ? (catByName.get(normalizeArea(bill.policyArea.name)) ?? null)
              : null,
            statusFromAction(action?.text ?? ''),
            bill.introducedDate ?? action?.actionDate ?? item.updateDate.slice(0, 10),
            action?.actionDate ?? item.updateDate.slice(0, 10),
            publicUrl(item.congress, item.type, item.number),
            SOURCE,
            externalId(item.congress, item.type, item.number),
            action?.text ?? '',
            bill.updateDate ?? item.updateDate,
          ],
        );
        const billId = saved[0]!.id;
        for (const [i, leaderId] of sponsorIds.entries()) {
          await pool.query(
            `INSERT INTO bill_sponsors (bill_id, leader_id, role) VALUES ($1, $2, $3)
             ON CONFLICT (bill_id, leader_id) DO NOTHING`,
            [billId, leaderId, i === 0 ? 'sponsor' : 'cosponsor'],
          );
        }
        bills++;
        lastUpdate = item.updateDate;
      }
      if (bills >= max) break;
      if (!page.pagination?.next || (page.bills ?? []).length === 0) {
        complete = true;
        break;
      }
      offset += (page.bills ?? []).length;
    }
    await pool.query(
      `UPDATE sync_state SET last_success_at = now(), last_error = NULL, items_last_run = $2,
              synced_through = COALESCE($3::timestamptz, synced_through)
        WHERE source = $1`,
      // Complete: everything up to `now` is synced. Capped: resume from the last
      // bill processed (bills come in ascending update order; re-processing one
      // bill is harmless because the sync upserts).
      [SOURCE, bills, complete ? now : lastUpdate ? new Date(lastUpdate) : null],
    );
    if (bills > 0) await pool.query('UPDATE data_version SET dirty = true');
    return { bills, leaders, through: complete ? now : lastUpdate ? new Date(lastUpdate) : from };
  } catch (err) {
    await pool.query('UPDATE sync_state SET last_error = $2 WHERE source = $1', [
      SOURCE,
      (err as Error).message.slice(0, 500),
    ]);
    throw err;
  }
}
