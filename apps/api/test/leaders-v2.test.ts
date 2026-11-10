import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recomputeRollups } from '../src/civic/rollups.js';
import { displayName, syncMembers } from '../src/ingest/members.js';
import { bearer, createHarness, moderator, onboard, signIn, type Harness } from './harness.js';

let h: Harness;
let alice: string;
let mod: string;

beforeAll(async () => {
  h = await createHarness();
  alice = (await signIn(h, (await onboard(h, 'alice')).device)).json().token;
  mod = await moderator(h, 'mod_leaders');
});
afterAll(async () => {
  await h?.close();
});

const call = (
  method: NonNullable<InjectOptions['method']>,
  url: string,
  token?: string | null,
  payload?: Record<string, unknown>,
) => {
  const options: InjectOptions = { method, url };
  if (token) options.headers = bearer(token);
  if (payload !== undefined) options.payload = payload;
  return h.app.inject(options);
};

const member = (id: string, name: string, state: string, chamber: string, district?: number) => ({
  bioguideId: id,
  name,
  partyName: 'Independent',
  state,
  ...(district ? { district } : {}),
  terms: { item: [{ chamber, startYear: 2023 }] },
  depiction: {
    imageUrl: `https://www.congress.gov/img/member/${id}.jpg`,
    attribution: 'Image courtesy of the Member',
  },
});

function fakeMembers(list: unknown[]) {
  return (async () => Response.json({ members: list, pagination: {} })) as unknown as typeof fetch;
}

describe('sitting members of Congress', () => {
  it('stores MVP-state members with photos, and marks departed members out of office', async () => {
    expect(displayName('Frost, Maxwell')).toBe('Maxwell Frost');
    const first = await syncMembers(
      h.apiPool,
      'k',
      fakeMembers([
        member('F000001', 'Frost, Maxwell', 'Florida', 'House of Representatives', 10),
        member('S000002', 'Smith, Ana', 'Texas', 'Senate'),
        member('O000003', 'Other, Ohio', 'Ohio', 'Senate'), // not an MVP state: not stored
      ]),
    );
    expect(first).toMatchObject({ current: 2, leftOffice: 0 });
    const { rows } = await h.apiPool.query(
      "SELECT name, office, office_kind, photo_credit FROM leaders WHERE source = 'congress.gov' ORDER BY name",
    );
    expect(rows).toEqual([
      {
        name: 'Ana Smith',
        office: 'U.S. Senator, Texas',
        office_kind: 'us_senate',
        photo_credit: 'Image courtesy of the Member',
      },
      {
        name: 'Maxwell Frost',
        office: 'U.S. Representative, Florida-10',
        office_kind: 'us_house',
        photo_credit: 'Image courtesy of the Member',
      },
    ]);

    // Next sync: Smith is no longer a current member.
    const second = await syncMembers(
      h.apiPool,
      'k',
      fakeMembers([member('F000001', 'Frost, Maxwell', 'Florida', 'House of Representatives', 10)]),
    );
    expect(second.leftOffice).toBe(1);
    const { rows: smith } = await h.apiPool.query(
      "SELECT in_office, left_office_at IS NOT NULL AS left FROM leaders WHERE external_id = 'S000002'",
    );
    expect(smith[0]).toEqual({ in_office: false, left: true });
  });
});

describe('stances and comparison', () => {
  async function slugOf(id: string) {
    return (
      await h.apiPool.query<{ slug: string }>('SELECT slug FROM leaders WHERE external_id = $1', [
        id,
      ])
    ).rows[0]!.slug;
  }

  it('records stances with an approved source and keeps the timeline', async () => {
    const frost = await slugOf('F000001');
    const base = {
      category: 'health',
      position: 'support',
      statement: 'Supports expanding community health centers.',
      sourceUrl: 'https://www.congress.gov/congressional-record/x',
      statedOn: '2025-03-01',
    };
    expect(
      (await call('POST', `/v1/moderation/leaders/${frost}/stances`, alice, base)).statusCode,
    ).toBe(403);
    expect(
      (await call('POST', `/v1/moderation/leaders/${frost}/stances`, mod, base)).statusCode,
    ).toBe(201);
    expect(
      (
        await call('POST', `/v1/moderation/leaders/${frost}/stances`, mod, {
          ...base,
          position: 'mixed',
          statement: 'Now supports centers but wants a funding cap.',
          statedOn: '2026-06-01',
        })
      ).statusCode,
    ).toBe(201);
    const { stances } = (await call('GET', `/v1/leaders/${frost}/stances`)).json();
    expect(stances.map((s: { position: string }) => s.position)).toEqual(['mixed', 'support']); // newest first
  });

  it('compares two leaders side by side', async () => {
    const frost = await slugOf('F000001');
    const smith = await slugOf('S000002');
    const r = (await call('GET', `/v1/compare?a=${frost}&b=${smith}`)).json();
    expect(r.a.leader.name).toBe('Maxwell Frost');
    expect(r.b.leader.inOffice).toBe(false);
    expect(r.a.stances.health.position).toBe('mixed'); // latest stance
    expect(r.categories.length).toBeGreaterThan(0);
    expect((await call('GET', `/v1/compare?a=${frost}&b=${frost}`)).statusCode).toBe(400);
  });

  it('freezes scores at the date a leader left office', async () => {
    const smithId = (
      await h.apiPool.query<{ id: string }>("SELECT id FROM leaders WHERE external_id = 'S000002'")
    ).rows[0]!.id;
    const health = (
      await h.apiPool.query<{ id: string }>("SELECT id FROM communities WHERE slug = 'health'")
    ).rows[0]!.id;
    await h.apiPool.query("UPDATE leaders SET left_office_at = '2024-01-01' WHERE id = $1", [
      smithId,
    ]);
    await h.apiPool.query(
      `INSERT INTO citations (leader_id, category_id, direction, claim, source_url, source_domain, action_date,
                              status, trust_at_add, accurate_yes, accurate_no)
       VALUES ($1, $2, 'negative', 'Voted against clinic funding.', 'https://www.congress.gov/x', 'gov',
               '2023-06-01', 'accepted', 0.5, 9, 1)`,
      [smithId, health],
    );
    await recomputeRollups(h.apiPool, new Date('2026-11-10'));
    const a = (
      await h.apiPool.query<{ score: number }>(
        'SELECT score FROM category_scores WHERE subject_id = $1 AND category_id = $2',
        [smithId, health],
      )
    ).rows[0]!.score;
    // Ten years later the score is unchanged, because time stopped when they left.
    await recomputeRollups(h.apiPool, new Date('2036-11-10'));
    const b = (
      await h.apiPool.query<{ score: number }>(
        'SELECT score FROM category_scores WHERE subject_id = $1 AND category_id = $2',
        [smithId, health],
      )
    ).rows[0]!.score;
    expect(b).toBe(a);
  });
});
