import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, moderator, onboard, signIn, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.close();
});

describe('transparency report', () => {
  it('aggregates public moderation numbers without identifying anyone', async () => {
    const mod = await moderator(h, 'mod_transparent');
    const alice = (await signIn(h, (await onboard(h, 'alice')).device)).json().token;
    const post = (
      await h.app.inject({
        method: 'POST',
        url: '/v1/communities/health/posts',
        headers: bearer(alice),
        payload: { title: 'A post to remove', body: 'Spam spam spam.' },
      })
    ).json().id;
    await h.app.inject({
      method: 'POST',
      url: `/v1/moderation/posts/${post}/remove`,
      headers: bearer(mod),
      payload: { reasonCode: 'spam' },
    });
    const res = await h.app.inject({ method: 'GET', url: '/v1/transparency' });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.ads).toEqual({ enabled: false, impressions: 0 });
    expect(r.moderators.total).toBe(1);
    expect(r.moderationActions).toContainEqual({
      action: 'post.removed',
      reasonCode: 'spam',
      actor: 'moderator',
      count: 1,
    });
    expect(JSON.stringify(r)).not.toMatch(/mod_transparent|alice/);
    expect(
      (await h.app.inject({ method: 'GET', url: '/v1/transparency?from=2020-01-01&to=2026-01-01' }))
        .statusCode,
    ).toBe(400); // more than a year
  });
});

describe('contextual-ad slot', () => {
  it('is disabled and ignores who is asking', async () => {
    const alice = (await signIn(h, (await onboard(h, 'bob')).device)).json().token;
    const guest = (
      await h.app.inject({ method: 'GET', url: '/v1/ads/slot?context=bill:health' })
    ).json();
    const member = (
      await h.app.inject({
        method: 'GET',
        url: '/v1/ads/slot?context=bill:health',
        headers: bearer(alice),
      })
    ).json();
    expect(guest).toEqual(member);
    expect(guest).toMatchObject({ enabled: false, ad: null });
  });
});
