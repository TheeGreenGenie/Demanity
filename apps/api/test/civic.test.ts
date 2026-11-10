import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearSampleData, seedSampleCivic } from '../dev/seed-sample-civic.js';
import { assertNoDevSeedData } from '../src/dev-seed-guard.js';
import { bearer, createHarness, onboard, signIn, type Harness } from './harness.js';

let h: Harness;
let alice: string;
let bob: string;

beforeAll(async () => {
  h = await createHarness();
  alice = (await signIn(h, (await onboard(h, 'alice')).device)).json().token;
  bob = (await signIn(h, (await onboard(h, 'bob')).device)).json().token;
  await seedSampleCivic(h.apiPool);
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

describe('places', () => {
  it('links the state community to its place page', async () => {
    const c = (await call('GET', '/v1/communities/california')).json();
    expect(c.place).toBe('california');
    expect((await call('GET', '/v1/communities/health')).json().place).toBeNull();
  });

  it('shows leaders, issues, elections, statistics and child places', async () => {
    const res = await call('GET', '/v1/places/california');
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p).toMatchObject({ kind: 'state', parent: { slug: 'united-states' } });
    expect(p.leaders.length).toBeGreaterThan(0);
    expect(p.leaders.every((l: { isSample: boolean }) => l.isSample)).toBe(true);
    expect(p.issues).toHaveLength(3);
    expect(p.elections.length).toBeGreaterThan(0);
    expect(p.stats.map((s: { key: string }) => s.key)).toEqual(
      expect.arrayContaining(['cost_of_living', 'groceries', 'median_rent']),
    );
    const col = p.stats.find((s: { key: string }) => s.key === 'cost_of_living');
    expect(col.peerCount).toBe(5); // compared with the 5 states only
    expect(col.peerMedian).toEqual(expect.any(Number));
    expect(p.children.map((c: { kind: string }) => c.kind)).toEqual(
      expect.arrayContaining(['county', 'city', 'court_district']),
    );
  });

  it('scores all 32 categories with explanations, compared only with the same kind of place', async () => {
    const city = (await call('GET', '/v1/places/austin-tx/scores')).json();
    expect(city.peerGroup).toBe('city');
    expect(city.categories).toHaveLength(32);
    const health = city.categories.find(
      (c: { category: { slug: string } }) => c.category.slug === 'health',
    );
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
    expect(health.rationale).toMatch(/SAMPLE EXPLANATION/);
    expect(health.peers.count).toBe(8); // 8 sample cities
    expect(health.peers.rank).toBeGreaterThanOrEqual(1);
    const state = (await call('GET', '/v1/places/texas/scores')).json();
    expect(state.categories[0].peers.count).toBe(5);
    expect(state.overall.peers.count).toBe(5);
  });

  it('404s unknown places', async () => {
    expect((await call('GET', '/v1/places/atlantis')).statusCode).toBe(404);
  });
});

describe('leaders', () => {
  async function aLeader(kind = 'governor') {
    const { rows } = await h.apiPool.query<{ slug: string }>(
      'SELECT slug FROM leaders WHERE office_kind = $1 ORDER BY name LIMIT 1',
      [kind],
    );
    return rows[0]!.slug;
  }

  it('shows legislation, scores with explanations and peers by office', async () => {
    const slug = await aLeader('us_senate');
    const l = (await call('GET', `/v1/leaders/${slug}`)).json();
    expect(l.office).toMatch(/Senator/);
    expect(Array.isArray(l.passed)).toBe(true);
    expect(Array.isArray(l.sponsored)).toBe(true);
    const s = (await call('GET', `/v1/leaders/${slug}/scores`)).json();
    expect(s.peerGroup).toBe('us_senate');
    expect(s.categories).toHaveLength(32);
    const scored = s.categories.filter((c: { score: number | null }) => c.score !== null);
    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0].peers.count).toBeLessThanOrEqual(10); // 10 sample senators
  });

  it('lets members request things and upvote them once each', async () => {
    const slug = await aLeader();
    expect(
      (await call('POST', `/v1/leaders/${slug}/requests`, null, { title: 'Fix the roads' }))
        .statusCode,
    ).toBe(401);
    const created = await call('POST', `/v1/leaders/${slug}/requests`, alice, {
      title: 'Fix the roads please',
      body: 'Potholes everywhere.',
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();
    expect((await call('PUT', `/v1/leader-requests/${id}/vote`, bob)).statusCode).toBe(204);
    expect((await call('PUT', `/v1/leader-requests/${id}/vote`, bob)).statusCode).toBe(204);
    let list = (await call('GET', `/v1/leaders/${slug}/requests`, bob)).json().requests;
    let mine = list.find((r: { id: string }) => r.id === id);
    expect(mine).toMatchObject({ votes: 2, myVote: true, author: { username: 'alice' } });
    expect(list[0].votes).toBeGreaterThanOrEqual(list[list.length - 1].votes); // most wanted first
    await call('DELETE', `/v1/leader-requests/${id}/vote`, bob);
    list = (await call('GET', `/v1/leaders/${slug}/requests`, bob)).json().requests;
    mine = list.find((r: { id: string }) => r.id === id);
    expect(mine).toMatchObject({ votes: 1, myVote: false });
  });
});

describe('bill stances (swipe)', () => {
  it('records support privately, once, and reveals results only after weighing in', async () => {
    const deck = (await call('GET', '/v1/bills/deck', alice)).json().bills;
    expect(deck.length).toBeGreaterThan(0);
    const bill = deck[0];
    expect(bill.tally).toBeNull();

    expect(
      (await call('POST', `/v1/bills/${bill.id}/stance`, null, { stance: 'support' })).statusCode,
    ).toBe(401);
    const res = await call('POST', `/v1/bills/${bill.id}/stance`, alice, { stance: 'support' });
    expect(res.statusCode).toBe(200);
    expect(res.json().tally).toEqual({ support: 1, oppose: 0 });

    // No way to vote twice or change it.
    const again = await call('POST', `/v1/bills/${bill.id}/stance`, alice, { stance: 'oppose' });
    expect(again.statusCode).toBe(409);
    expect(
      (await call('POST', `/v1/bills/${bill.id}/stance`, alice, { stance: 'maybe' })).statusCode,
    ).toBe(400);

    // Results hidden from people who haven't weighed in.
    expect((await call('GET', `/v1/bills/${bill.id}`, bob)).json().tally).toBeNull();
    expect((await call('GET', `/v1/bills/${bill.id}`, alice)).json()).toMatchObject({
      weighedIn: true,
      tally: { support: 1, oppose: 0 },
    });
    // It leaves the deck.
    const after = (await call('GET', '/v1/bills/deck', alice)).json().bills;
    expect(after.map((b: { id: string }) => b.id)).not.toContain(bill.id);
  });

  it('stores no link between a person and which way they swiped', async () => {
    const { rows } = await h.apiPool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'bill_swipes' ORDER BY column_name",
    );
    expect(rows.map((r) => r.column_name)).toEqual(['account_id', 'bill_id']);
  });

  it('filters common-ground (bipartisan) bills', async () => {
    const { bills } = (await call('GET', '/v1/bills?bipartisan=true')).json();
    expect(bills.length).toBeGreaterThan(0);
    expect(bills.every((b: { bipartisan: boolean }) => b.bipartisan)).toBe(true);
  });
});

describe('search', () => {
  it('finds communities, places, leaders and bills, but not Humanity', async () => {
    const r = (await call('GET', '/v1/search?q=health')).json();
    expect(r.communities.map((c: { slug: string }) => c.slug)).toContain('health');
    const tx = (await call('GET', '/v1/search?q=texas')).json();
    expect(tx.places.map((p: { slug: string }) => p.slug)).toContain('texas');
    const h1 = (await call('GET', '/v1/search?q=humanity')).json();
    expect(h1.communities).toHaveLength(0);
  });

  it('treats wildcards literally and validates length', async () => {
    const r = (await call('GET', '/v1/search?q=%25%25')).json(); // "%%"
    expect(r.communities).toHaveLength(0);
    expect((await call('GET', '/v1/search?q=a')).statusCode).toBe(400);
  });
});

describe('community sorting', () => {
  it('accepts new, hot and top and rejects others', async () => {
    for (const sort of ['new', 'hot', 'top'])
      expect((await call('GET', `/v1/communities/health/posts?sort=${sort}`)).statusCode).toBe(200);
    expect((await call('GET', '/v1/communities/health/posts?sort=best')).statusCode).toBe(400);
  });
});

describe('Humanity guides', () => {
  it('lists informational guides with official sources', async () => {
    const { guides } = (await call('GET', '/v1/guides')).json();
    expect(guides.length).toBeGreaterThanOrEqual(5);
    const g = (await call('GET', '/v1/guides/how-a-bill-becomes-law')).json();
    expect(g.body).toMatch(/committee/);
    expect(g.sources[0].url).toMatch(/^https:\/\/www\.usa\.gov\//);
  });
});

describe('production guard', () => {
  it('refuses to start while sample data exists, and passes after cleanup', async () => {
    await expect(assertNoDevSeedData(h.apiPool)).rejects.toThrow(/sample data/);
    await clearSampleData(h.apiPool);
    await assertNoDevSeedData(h.apiPool);
    // Reference places survive the cleanup.
    expect((await call('GET', '/v1/places/california')).statusCode).toBe(200);
  });
});
