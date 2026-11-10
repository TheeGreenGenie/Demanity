import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recomputeRollups } from '../src/civic/rollups.js';
import { bearer, createHarness, moderator, onboard, signIn, type Harness } from './harness.js';

let h: Harness;
let alice: string; // contributor
let bob: string; // will claim a leader page
let carol: string; // plain member
let mod: string;
let mod2: string;

beforeAll(async () => {
  h = await createHarness();
  alice = (await signIn(h, (await onboard(h, 'alice')).device)).json().token;
  bob = (await signIn(h, (await onboard(h, 'bob')).device)).json().token;
  carol = (await signIn(h, (await onboard(h, 'carol')).device)).json().token;
  mod = await moderator(h, 'mod_cite');
  mod2 = await moderator(h, 'mod_cite2');
  // Two test leaders (not sample data): a senator and a mayor.
  await h.apiPool.query(
    `INSERT INTO leaders (slug, name, office, office_kind, party, place_id)
     SELECT 'test-senator', 'Test Senator', 'U.S. Senator', 'us_senate', 'Independent', id FROM places WHERE slug = 'texas'`,
  );
  await h.apiPool.query(
    `INSERT INTO leaders (slug, name, office, office_kind, party, place_id)
     SELECT 'test-mayor', 'Test Mayor', 'Mayor', 'mayor', 'Independent', id FROM places WHERE slug = 'texas'`,
  );
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

const citation = (over: Record<string, unknown> = {}) => ({
  category: 'health',
  direction: 'positive',
  claim: 'Voted for the community clinic funding bill.',
  sourceUrl: 'https://www.congress.gov/bill/119th-congress/house-bill/1',
  actionDate: '2026-06-01',
  ...over,
});

describe('submitting citations', () => {
  it('only lets granted contributors submit, from approved sources, in applicable categories', async () => {
    expect(
      (await call('POST', '/v1/leaders/test-senator/citations', carol, citation())).json(),
    ).toEqual({
      error: 'contributors_only',
    });
    expect(
      (
        await call('PUT', '/v1/moderation/contributors', mod, {
          username: 'alice',
          category: 'health',
          reasonCode: 'essay_approved',
        })
      ).statusCode,
    ).toBe(204);

    const bad = await call(
      'POST',
      '/v1/leaders/test-senator/citations',
      alice,
      citation({ sourceUrl: 'https://some-blog.example/post' }),
    );
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toBe('source_not_approved');

    const mayorForeign = await call(
      'POST',
      '/v1/leaders/test-mayor/citations',
      mod,
      citation({ category: 'international-affairs' }),
    );
    expect(mayorForeign.json().error).toBe('category_not_applicable');

    const ok = await call('POST', '/v1/leaders/test-senator/citations', alice, citation());
    expect(ok.statusCode).toBe(201);
    expect(ok.json().status).toBe('pending');
  });

  it('blocks leaders from citing themselves and names them when they cite others', async () => {
    await h.apiPool.query(
      "UPDATE leaders SET account_id = (SELECT id FROM accounts WHERE username = 'bob') WHERE slug = 'test-senator'",
    );
    expect(
      (await call('POST', '/v1/leaders/test-senator/citations', bob, citation())).json().error,
    ).toBe('self_citation');
    const other = await call(
      'POST',
      '/v1/leaders/test-mayor/citations',
      bob,
      citation({ direction: 'negative', claim: 'Closed two clinics without public notice.' }),
    );
    expect(other.statusCode).toBe(201);
  });
});

describe('moderation, private votes and the v1 trust score', () => {
  it('moderators accept (never their own), members vote once, and the batch recompute scores it', async () => {
    // Moderators can't decide their own submissions.
    const own = (await call('POST', '/v1/leaders/test-senator/citations', mod, citation())).json()
      .id;
    expect(
      (
        await call('POST', `/v1/moderation/citations/${own}/decision`, mod, {
          decision: 'accept',
          reasonCode: 'source_verified',
        })
      ).json().error,
    ).toBe('cannot_decide_own_case');

    // Alice submits two more positives so the streak (3 at t = 0.5) is reached.
    for (const d of ['2026-07-01', '2026-08-01'])
      await call('POST', '/v1/leaders/test-senator/citations', alice, citation({ actionDate: d }));
    const pending = (await call('GET', '/v1/moderation/citations', mod)).json().citations;
    expect(pending.length).toBeGreaterThanOrEqual(5);
    expect((await call('GET', '/v1/moderation/citations', carol)).statusCode).toBe(403);

    // Mismatched reason code is refused.
    expect(
      (
        await call('POST', `/v1/moderation/citations/${pending[0].id}/decision`, mod, {
          decision: 'accept',
          reasonCode: 'duplicate_citation',
        })
      ).statusCode,
    ).toBe(400);

    for (const c of pending) {
      const decider = c.id === own ? mod2 : mod;
      const res = await call('POST', `/v1/moderation/citations/${c.id}/decision`, decider, {
        decision: 'accept',
        reasonCode: 'source_verified',
      });
      expect(res.statusCode).toBe(200);
    }

    const list = (
      await call('GET', '/v1/leaders/test-senator/citations?category=health', carol)
    ).json().citations;
    expect(list).toHaveLength(4);
    expect(list.every((c: { attribution: string }) => c.attribution === 'Contributor')).toBe(true);

    for (const c of list) {
      expect(
        (
          await call('POST', `/v1/citations/${c.id}/votes`, carol, {
            kind: 'accurate',
            value: true,
          })
        ).statusCode,
      ).toBe(200);
      await call('POST', `/v1/citations/${c.id}/votes`, alice, { kind: 'accurate', value: true });
    }
    // One vote per kind per member; approval is a separate vote.
    expect(
      (
        await call('POST', `/v1/citations/${list[0].id}/votes`, carol, {
          kind: 'accurate',
          value: false,
        })
      ).statusCode,
    ).toBe(409);
    const approve = await call('POST', `/v1/citations/${list[0].id}/votes`, carol, {
      kind: 'approve',
      value: false,
    });
    expect(approve.json()).toMatchObject({ accurateYes: 2, approveNo: 1 });

    // Votes mark the data dirty; the batch job recomputes.
    const { rows: flag } = await h.apiPool.query<{ dirty: boolean }>(
      'SELECT dirty FROM data_version',
    );
    expect(flag[0]!.dirty).toBe(true);
    await recomputeRollups(h.apiPool);
    const { rows: after } = await h.apiPool.query<{ dirty: boolean }>(
      'SELECT dirty FROM data_version',
    );
    expect(after[0]!.dirty).toBe(false);

    const scores = (await call('GET', '/v1/leaders/test-senator/scores')).json();
    const health = scores.categories.find(
      (c: { category: { slug: string } }) => c.category.slug === 'health',
    );
    expect(health.methodVersion).toBe('scoring-v1');
    expect(health.score).toBeGreaterThan(50);
    expect(health.evidenceCount).toBe(4);
    expect(health.evidence[0].url).toMatch(/^https:\/\/www\.congress\.gov\//);
    expect(health.rationale).toMatch(/4 counted citations \(4 positive, 0 negative\)/);
    expect(scores.overall.score).not.toBeNull();
  });

  it('shows a leader’s citations under their name and lowers the cited leader’s score', async () => {
    // Bob's citation of the mayor was accepted with the others above.
    const [byBob] = (await call('GET', '/v1/leaders/test-mayor/citations')).json().citations;
    await call('POST', `/v1/citations/${byBob.id}/votes`, carol, { kind: 'accurate', value: true });
    await recomputeRollups(h.apiPool);
    const list = (await call('GET', '/v1/leaders/test-mayor/citations')).json().citations;
    expect(list[0].attribution).toBe('Cited by Test Senator');
    const health = (await call('GET', '/v1/leaders/test-mayor/scores'))
      .json()
      .categories.find((c: { category: { slug: string } }) => c.category.slug === 'health');
    expect(health.score).toBeLessThan(50);
  });

  it('stores which votes an account cast, never which way', async () => {
    const { rows } = await h.apiPool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'citation_vote_markers' ORDER BY column_name",
    );
    expect(rows.map((r) => r.column_name)).toEqual(['account_id', 'citation_id', 'kind']);
  });

  it('lists approved sources publicly', async () => {
    const { sources } = (await call('GET', '/v1/sources')).json();
    expect(sources.map((s: { domain: string }) => s.domain)).toEqual(
      expect.arrayContaining(['gov', 'apnews.com', 'reuters.com']),
    );
  });
});
