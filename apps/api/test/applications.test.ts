import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, moderator, onboard, signIn, type Harness } from './harness.js';

let h: Harness;
let alice: string;
let bob: string;
let mod: string;

beforeAll(async () => {
  h = await createHarness();
  alice = (await signIn(h, (await onboard(h, 'alice')).device)).json().token;
  bob = (await signIn(h, (await onboard(h, 'bob')).device)).json().token;
  mod = await moderator(h, 'mod_apps');
  await h.apiPool.query(
    `INSERT INTO leaders (slug, name, office, office_kind, party, place_id)
     SELECT 'real-governor', 'Real Governor', 'Governor of Texas', 'governor', 'Independent', id
       FROM places WHERE slug = 'texas'`,
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

const essay = 'Health policy essay. '.repeat(20); // > 300 characters

describe('contributor applications', () => {
  it('lets a member apply once per category; moderators approve into a 1-year grant', async () => {
    expect(
      (
        await call('POST', '/v1/contributor-applications', alice, {
          category: 'health',
          essay: 'too short',
        })
      ).statusCode,
    ).toBe(400);
    const res = await call('POST', '/v1/contributor-applications', alice, {
      category: 'health',
      essay,
    });
    expect(res.statusCode).toBe(201);
    expect(
      (
        await call('POST', '/v1/contributor-applications', alice, { category: 'health', essay })
      ).json().error,
    ).toBe('application_pending');

    const queue = (await call('GET', '/v1/moderation/contributor-applications', mod)).json()
      .applications;
    expect(queue).toHaveLength(1);
    expect(queue[0]).not.toHaveProperty('username'); // judge the essay, not the person
    expect((await call('GET', '/v1/moderation/contributor-applications', bob)).statusCode).toBe(
      403,
    );

    expect(
      (
        await call('POST', `/v1/moderation/contributor-applications/${queue[0].id}/decision`, mod, {
          decision: 'approve',
          reasonCode: 'essay_insufficient',
        })
      ).json().error,
    ).toBe('reason_does_not_match_decision');
    expect(
      (
        await call('POST', `/v1/moderation/contributor-applications/${queue[0].id}/decision`, mod, {
          decision: 'approve',
          reasonCode: 'essay_approved',
        })
      ).statusCode,
    ).toBe(200);

    const me = (await call('GET', '/v1/me/contributor', alice)).json();
    expect(me.grants).toEqual([expect.objectContaining({ category: 'health' })]);
    expect(new Date(me.grants[0].expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 360 * 86_400_000,
    );
    expect(me.applications[0]).toMatchObject({ status: 'approved', reasonCode: 'essay_approved' });
    // An active contributor doesn't re-apply.
    expect(
      (
        await call('POST', '/v1/contributor-applications', alice, { category: 'health', essay })
      ).json().error,
    ).toBe('already_contributor');
    const { rows } = await h.apiPool.query(
      "SELECT 1 FROM moderation_log WHERE action = 'contributor_application.approved'",
    );
    expect(rows).toHaveLength(1);
  });
});

describe('leader page claims', () => {
  const evidence = 'Email me at governor@texas.gov; the office phone is on gov.texas.gov.';

  it('takes one pending claim, keeps evidence private, and links the account on approval', async () => {
    expect((await call('GET', '/v1/leaders/real-governor/viewer', bob)).json()).toEqual({
      isLeader: false,
      claimPending: false,
      claimed: false,
    });
    expect(
      (await call('POST', '/v1/leaders/real-governor/claims', bob, { evidence })).statusCode,
    ).toBe(201);
    expect(
      (await call('POST', '/v1/leaders/real-governor/claims', alice, { evidence })).json().error,
    ).toBe('claim_pending');
    expect((await call('GET', '/v1/leaders/real-governor/viewer', bob)).json().claimPending).toBe(
      true,
    );

    const claims = (await call('GET', '/v1/moderation/leader-claims', mod)).json().claims;
    expect(claims[0]).toMatchObject({ leaderSlug: 'real-governor', username: 'bob', evidence });
    // Evidence never appears on the public leader page.
    expect((await call('GET', '/v1/leaders/real-governor')).body).not.toContain('texas.gov');

    expect(
      (
        await call('POST', `/v1/moderation/leader-claims/${claims[0].id}/decision`, mod, {
          decision: 'approve',
          reasonCode: 'identity_confirmed_official_channel',
        })
      ).statusCode,
    ).toBe(200);
    expect((await call('GET', '/v1/leaders/real-governor/viewer', bob)).json()).toMatchObject({
      isLeader: true,
      claimed: true,
    });
    expect(
      (await call('POST', '/v1/leaders/real-governor/claims', alice, { evidence })).json().error,
    ).toBe('already_claimed');
  });

  it('lets the claimed leader respond to requests', async () => {
    const created = await call('POST', '/v1/leaders/real-governor/requests', alice, {
      title: 'Publish your weekly schedule',
    });
    const id = created.json().id;
    const res = await call('PATCH', `/v1/leader-requests/${id}`, bob, {
      status: 'responded',
      response: 'Posting it every Monday.',
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses moderators deciding their own claim', async () => {
    await h.apiPool.query(
      `INSERT INTO leaders (slug, name, office, office_kind, party, place_id)
       SELECT 'other-leader', 'Other Leader', 'Mayor', 'mayor', '', id FROM places WHERE slug = 'texas'`,
    );
    const own = (await call('POST', '/v1/leaders/other-leader/claims', mod, { evidence })).json()
      .id;
    expect(
      (
        await call('POST', `/v1/moderation/leader-claims/${own}/decision`, mod, {
          decision: 'approve',
          reasonCode: 'identity_confirmed_official_channel',
        })
      ).json().error,
    ).toBe('cannot_decide_own_case');
  });
});
