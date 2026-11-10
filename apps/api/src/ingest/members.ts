import type { Pool } from '@demanity/db';
import { BudgetExhausted, isTransient, ProviderRateLimited, type ApiBudget } from './budget.js';

/**
 * Sitting members of Congress from the MVP states (R17, R30).
 *
 * GET https://api.congress.gov/v3/member?currentMember=true&limit=250&offset=…
 * → { members: [{ bioguideId, name: "Last, First", partyName, state (full
 * name), district (House only), terms: { item: [{ chamber, startYear }] },
 * depiction: { imageUrl, attribution } }], pagination: { count, next } }
 * (live check 2026-11-10: 539 current members, 3 requests).
 *
 * Only members from the 5 MVP states are stored (we sample, not everything).
 * Members we stored before who are no longer current are marked out of
 * office: their pages become read-only and their scores freeze.
 */

export const SOURCE = 'congress.gov';
const BASE = 'https://api.congress.gov/v3/member';

export interface CongressMember {
  bioguideId: string;
  name: string;
  partyName?: string;
  state?: string;
  district?: number | null;
  terms?: { item?: Array<{ chamber?: string; startYear?: number }> };
  depiction?: { imageUrl?: string; attribution?: string } | null;
}

export const MVP_STATE_NAMES: Record<string, string> = {
  California: 'california',
  Texas: 'texas',
  Florida: 'florida',
  'New York': 'new-york',
  Pennsylvania: 'pennsylvania',
};

/** "Frost, Maxwell" → "Maxwell Frost" (suffixes like "Jr." kept at the end). */
export function displayName(name: string): string {
  const [last, first] = name.split(',').map((x) => x.trim());
  return first ? `${first} ${last}` : name.trim();
}

export async function fetchCurrentMembers(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  budget: ApiBudget | null = null,
): Promise<CongressMember[]> {
  const out: CongressMember[] = [];
  for (let offset = 0; offset < 2000; offset += 250) {
    const url = new URL(BASE);
    url.searchParams.set('currentMember', 'true');
    url.searchParams.set('limit', '250');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('format', 'json');
    url.searchParams.set('api_key', apiKey);
    await budget?.take();
    const res = await fetchFn(url.toString());
    if (isTransient(res.status)) throw new ProviderRateLimited(SOURCE, res.status);
    if (!res.ok) throw new Error(`Congress.gov /member failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      members?: CongressMember[];
      pagination?: { next?: string };
    };
    out.push(...(body.members ?? []));
    if (!body.pagination?.next || (body.members ?? []).length === 0) break;
  }
  return out;
}

export async function syncMembers(
  pool: Pool,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  budget: ApiBudget | null = null,
): Promise<{ current: number; leftOffice: number; stoppedEarly: string | null }> {
  let members: CongressMember[];
  try {
    members = await fetchCurrentMembers(apiKey, fetchFn, budget);
  } catch (err) {
    // A partial list would wrongly mark people as out of office: change nothing.
    if (err instanceof BudgetExhausted || err instanceof ProviderRateLimited)
      return { current: 0, leftOffice: 0, stoppedEarly: err.message };
    throw err;
  }
  const { rows: places } = await pool.query<{ id: string; slug: string }>(
    "SELECT id, slug FROM places WHERE kind = 'state'",
  );
  const placeId = new Map(places.map((p) => [p.slug, p.id]));
  const keep: string[] = [];
  for (const m of members) {
    const slug = MVP_STATE_NAMES[m.state ?? ''];
    if (!slug) continue;
    const terms = m.terms?.item ?? [];
    const latest = terms[terms.length - 1];
    const senate = (latest?.chamber ?? '').includes('Senate');
    const name = displayName(m.name);
    await pool.query(
      `INSERT INTO leaders (slug, name, office, office_kind, party, place_id, source, external_id,
                            photo_url, photo_credit, in_office, left_office_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NULL)
       ON CONFLICT (source, external_id) DO UPDATE
         SET name = EXCLUDED.name, office = EXCLUDED.office, office_kind = EXCLUDED.office_kind,
             party = EXCLUDED.party, place_id = EXCLUDED.place_id, photo_url = EXCLUDED.photo_url,
             photo_credit = EXCLUDED.photo_credit, in_office = true, left_office_at = NULL`,
      [
        `${name}-${m.bioguideId}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 80),
        name,
        senate
          ? `U.S. Senator, ${m.state}`
          : `U.S. Representative, ${m.state}-${m.district ?? 'at large'}`,
        senate ? 'us_senate' : 'us_house',
        m.partyName ?? '',
        placeId.get(slug) ?? null,
        SOURCE,
        m.bioguideId,
        m.depiction?.imageUrl ?? null,
        m.depiction?.attribution ?? null,
      ],
    );
    keep.push(m.bioguideId);
  }
  // Lifecycle (R17): anyone we track (including bill sponsors from other
  // states) who is not in the FULL current list has left office.
  const { rowCount } = await pool.query(
    `UPDATE leaders SET in_office = false, left_office_at = now()
      WHERE source = $1 AND office_kind IN ('us_senate', 'us_house') AND in_office
        AND NOT (external_id = ANY($2::text[]))`,
    [SOURCE, members.map((m) => m.bioguideId)],
  );
  await pool.query('UPDATE data_version SET dirty = true');
  return { current: keep.length, leftOffice: rowCount ?? 0, stoppedEarly: null };
}
