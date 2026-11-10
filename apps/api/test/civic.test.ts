import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearSampleData, seedSampleCivic } from '../dev/seed-sample-civic.js';
import { assertNoDevSeedData } from '../src/dev-seed-guard.js';
import { bearer, createHarness, moderator, onboard, signIn, type Harness } from './harness.js';

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
    expect(city.peerGroup).toBe('city:large');
    expect(city.categories).toHaveLength(32);
    const health = city.categories.find(
      (c: { category: { slug: string } }) => c.category.slug === 'health',
    );
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
    expect(health.rationale).toMatch(/SAMPLE EXPLANATION/);
    expect(health.peers.count).toBe(4); // similar-size peers: sample cities with 250k-1M people
    expect(city.peerLabel).toBe('cities with 250k–1M people');
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
    expect(s.peerGroup).toBe('leader:us_senate');
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

describe('applicability and conditions vs. trust', () => {
  it('never scores categories that do not apply to the level of government', async () => {
    const city = (await call('GET', '/v1/places/austin-tx/scores')).json();
    expect(city.kind).toBe('conditions');
    const foreign = city.categories.find(
      (c: { category: { slug: string } }) => c.category.slug === 'international-affairs',
    );
    expect(foreign).toMatchObject({ applicable: false, score: null, peers: null });
    const nation = (await call('GET', '/v1/places/united-states/scores')).json();
    expect(nation.categories.every((c: { applicable: boolean }) => c.applicable)).toBe(true);
  });

  it('labels leader scores as trust scores and skips foreign policy for mayors', async () => {
    const { rows } = await h.apiPool.query<{ slug: string }>(
      "SELECT slug FROM leaders WHERE office_kind = 'mayor' LIMIT 1",
    );
    const s = (await call('GET', `/v1/leaders/${rows[0]!.slug}/scores`)).json();
    expect(s.kind).toBe('trust');
    expect(s.peerLabel).toBe('mayors');
    const war = s.categories.find(
      (c: { category: { slug: string } }) =>
        c.category.slug === 'armed-forces-and-national-security',
    );
    expect(war).toMatchObject({ applicable: false, score: null });
  });
});

describe('precomputed data and caching', () => {
  it('serves cached public pages with an ETag and answers 304 when unchanged', async () => {
    const first = await call('GET', '/v1/places/california');
    expect(first.headers['cache-control']).toMatch(/public/);
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();
    const again = await h.app.inject({
      method: 'GET',
      url: '/v1/places/california',
      headers: { 'if-none-match': etag },
    });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
  });

  it('includes the monthly-basics cost figure compared with peers', async () => {
    const p = (await call('GET', '/v1/places/texas')).json();
    expect(p.cost.basicsMonthly).toBeGreaterThan(0);
    expect(p.cost.peerCount).toBe(5);
    expect(p.cost.formula).toMatch(/gallons of gasoline/);
  });
});

describe('request accountability', () => {
  async function governor() {
    const { rows } = await h.apiPool.query<{ slug: string }>(
      "SELECT slug FROM leaders WHERE office_kind = 'governor' ORDER BY created_at LIMIT 1",
    );
    return rows[0]!.slug;
  }

  it('shows status, responses and how long a request has waited past the threshold', async () => {
    const list = (await call('GET', `/v1/leaders/${await governor()}/requests`)).json();
    expect(list.threshold).toBe(25);
    const waiting = list.requests.find((r: { title: string }) => r.title.includes('town hall'));
    expect(waiting.awaitingResponseDays).toBe(12);
    const answered = list.requests.find((r: { title: string }) => r.title.includes('schedule'));
    expect(answered).toMatchObject({ status: 'responded', awaitingResponseDays: null });
    expect(answered.response).toMatch(/Sample response/);
  });

  it('lets only the claimed leader respond, and moderators merge duplicates with a reason', async () => {
    const slug = await governor();
    const a = (
      await call('POST', `/v1/leaders/${slug}/requests`, alice, { title: 'Fix potholes on Main' })
    ).json().id;
    const b = (
      await call('POST', `/v1/leaders/${slug}/requests`, bob, {
        title: 'Repair Main Street potholes',
      })
    ).json().id;

    // Not the leader yet: refused.
    expect(
      (
        await call('PATCH', `/v1/leader-requests/${a}`, alice, {
          status: 'responded',
          response: 'Hi',
        })
      ).statusCode,
    ).toBe(403);

    // Alice claims the governor page (claim flow comes later; set directly here).
    await h.apiPool.query(
      'UPDATE leaders SET account_id = (SELECT id FROM accounts WHERE username = $1) WHERE slug = $2',
      ['alice', slug],
    );
    expect(
      (await call('PATCH', `/v1/leader-requests/${a}`, alice, { status: 'responded' })).statusCode,
    ).toBe(400); // a response is required
    expect(
      (
        await call('PATCH', `/v1/leader-requests/${a}`, alice, {
          status: 'responded',
          response: 'Crews start Monday.',
        })
      ).statusCode,
    ).toBe(200);

    // Moderator merges Bob's duplicate into Alice's request; votes move over.
    const mod = await moderator(h, 'mod_requests');
    expect(
      (await call('PATCH', `/v1/leader-requests/${b}`, mod, { status: 'merged', mergeInto: a }))
        .statusCode,
    ).toBe(400); // reason code required
    expect(
      (
        await call('PATCH', `/v1/leader-requests/${b}`, mod, {
          status: 'merged',
          mergeInto: a,
          reasonCode: 'duplicate_request',
        })
      ).statusCode,
    ).toBe(200);
    const list = (await call('GET', `/v1/leaders/${slug}/requests`)).json().requests;
    expect(list.find((r: { id: string }) => r.id === b)).toBeUndefined();
    expect(list.find((r: { id: string }) => r.id === a)).toMatchObject({
      votes: 2,
      mergedCount: 1,
      status: 'responded',
      response: 'Crews start Monday.',
    });
    const { rows } = await h.apiPool.query(
      "SELECT 1 FROM moderation_log WHERE action = 'request.merged' AND reason_code = 'duplicate_request'",
    );
    expect(rows).toHaveLength(1);
    await h.apiPool.query('UPDATE leaders SET account_id = NULL WHERE slug = $1', [slug]);
  });
});

describe('follows and the home feed', () => {
  it('follows a leader and shows their bills in the feed with a reason', async () => {
    const { rows } = await h.apiPool.query<{ slug: string }>(
      `SELECT l.slug FROM leaders l JOIN bill_sponsors s ON s.leader_id = l.id
        JOIN bills b ON b.id = s.bill_id WHERE b.last_action_at >= CURRENT_DATE - 60 LIMIT 1`,
    );
    const slug = rows[0]!.slug;
    expect((await call('GET', `/v1/follows/leader/${slug}`, bob)).json().following).toBe(false);
    expect((await call('PUT', `/v1/follows/leader/${slug}`, bob)).statusCode).toBe(204);
    expect((await call('GET', `/v1/follows/leader/${slug}`, bob)).json().following).toBe(true);
    const feed = (await call('GET', '/v1/feed', bob)).json();
    expect(feed.following).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'leader', id: slug })]),
    );
    expect(feed.updates.length).toBeGreaterThan(0);
    expect(feed.updates[0].reason).toMatch(/follow/);
  });
});

describe('deck filters and stages', () => {
  it('filters by scope and stage and labels each bill with its stage', async () => {
    const fed = (await call('GET', '/v1/bills?scope=federal')).json().bills;
    expect(fed.length).toBeGreaterThan(0);
    expect(fed.every((b: { level: string }) => b.level === 'federal')).toBe(true);
    const decided = (await call('GET', '/v1/bills?stage=decided')).json().bills;
    expect(
      decided.every((b: { status: string }) => ['signed', 'vetoed', 'failed'].includes(b.status)),
    ).toBe(true);
    const deck = (await call('GET', '/v1/bills/deck?scope=state', bob)).json().bills;
    expect(deck.every((b: { level: string }) => b.level === 'state')).toBe(true);
    expect(deck[0].stage).toMatch(/proposed|voting|decided/);
  });
});

describe('mock election ballots', () => {
  it('takes one private ballot per member and shows results only afterwards', async () => {
    const { rows } = await h.apiPool.query<{ id: string }>(
      "SELECT e.id FROM elections e JOIN places p ON p.id = e.place_id WHERE p.slug = 'austin-tx' LIMIT 1",
    );
    const id = rows[0]!.id;
    const before = (await call('GET', `/v1/elections/${id}`, alice)).json();
    expect(before.candidates).toHaveLength(3);
    expect(before.candidates[0].votes).toBeNull();
    const cand = before.candidates[0].id;
    expect(
      (await call('POST', `/v1/elections/${id}/ballot`, alice, { candidateId: cand })).statusCode,
    ).toBe(400); // must attest to voting there
    expect(
      (
        await call('POST', `/v1/elections/${id}/ballot`, alice, {
          candidateId: cand,
          residentAttested: true,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call('POST', `/v1/elections/${id}/ballot`, alice, {
          candidateId: cand,
          residentAttested: true,
        })
      ).statusCode,
    ).toBe(409);
    const after = (await call('GET', `/v1/elections/${id}`, alice)).json();
    expect(after.total).toBe(1);
    expect(after.candidates.find((c: { id: string }) => c.id === cand).votes).toBe(1);
    expect((await call('GET', `/v1/elections/${id}`)).json().total).toBeNull(); // guest

    const { rows: cols } = await h.apiPool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'election_ballots' ORDER BY column_name",
    );
    expect(cols.map((c) => c.column_name)).toEqual(['account_id', 'election_id']);
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
