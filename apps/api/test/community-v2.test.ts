import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeRecipe, encodeRecipe } from '../src/routes/community-v2.js';
import { bearer, createHarness, moderator, onboard, signIn, type Harness } from './harness.js';

let h: Harness;
let alice: string;
let bob: string;
let mod: string;

beforeAll(async () => {
  h = await createHarness();
  alice = (await signIn(h, (await onboard(h, 'alice')).device)).json().token;
  bob = (await signIn(h, (await onboard(h, 'bob')).device)).json().token;
  mod = await moderator(h, 'mod_comm');
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
const newPost = async (token: string, community = 'health', title = 'A post for testing') =>
  (await call('POST', `/v1/communities/${community}/posts`, token, { title, body: 'Body.' })).json()
    .id as string;

describe('polls', () => {
  it('takes one private vote per member and shows results only after voting', async () => {
    const post = await newPost(alice);
    expect(
      (
        await call('POST', `/v1/posts/${post}/poll`, bob, {
          question: 'Which hours work?',
          options: ['A', 'B'],
        })
      ).statusCode,
    ).toBe(403); // only the author
    expect(
      (
        await call('POST', `/v1/posts/${post}/poll`, alice, {
          question: 'Which clinic hours work best?',
          options: ['Evenings', 'Weekends', 'Evenings'],
        })
      ).statusCode,
    ).toBe(201);
    const before = (await call('GET', `/v1/posts/${post}/poll`, bob)).json();
    expect(before.options).toHaveLength(2); // duplicates removed
    expect(before.total).toBeNull();
    expect(
      (await call('POST', `/v1/polls/${before.id}/vote`, bob, { optionId: before.options[0].id }))
        .statusCode,
    ).toBe(201);
    expect(
      (await call('POST', `/v1/polls/${before.id}/vote`, bob, { optionId: before.options[1].id }))
        .statusCode,
    ).toBe(409);
    const after = (await call('GET', `/v1/posts/${post}/poll`, bob)).json();
    expect(after).toMatchObject({ voted: true, total: 1 });
    expect(after.options[0].votes).toBe(1);
    const { rows } = await h.apiPool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'poll_ballots' ORDER BY column_name",
    );
    expect(rows.map((r) => r.column_name)).toEqual(['account_id', 'poll_id']);
  });
});

describe('reposts and feed preferences', () => {
  it('shows reposts from people you follow, and respects mutes and recipes', async () => {
    const post = await newPost(alice, 'education', 'School board meeting tonight');
    await call('PUT', '/v1/follows/user/alice', bob);
    expect(
      (
        await call('PUT', '/v1/reposts', alice, {
          targetType: 'post',
          targetId: post,
          comment: 'Worth reading',
        })
      ).statusCode,
    ).toBe(204);
    // Bob follows Alice, so he sees what she reposted, with a reason.
    const { reposts } = (await call('GET', '/v1/feed/reposts', bob)).json();
    expect(reposts[0]).toMatchObject({
      by: 'alice',
      comment: 'Worth reading',
      reason: expect.stringMatching(/reposted/),
    });

    // Bob's feed includes Alice's post; muting the community removes it.
    expect(
      (await call('GET', '/v1/feed', bob)).json().posts.map((p: { id: string }) => p.id),
    ).toContain(post);
    const saved = (
      await call('PUT', '/v1/me/feed-prefs', bob, { mutedCommunities: ['education'] })
    ).json();
    expect(
      (await call('GET', '/v1/feed', bob)).json().posts.map((p: { id: string }) => p.id),
    ).not.toContain(post);

    // Recipes share settings but never muted people.
    expect(decodeRecipe(saved.recipe)).toMatchObject({ mutedCommunities: ['education'] });
    expect(
      encodeRecipe({
        mutedCommunities: [],
        mutedAccounts: ['secret_person'],
        includeUpdates: true,
        includeReposts: true,
        sort: 'new',
      }),
    ).not.toContain(Buffer.from('secret_person').toString('base64url').slice(0, 8));
    const imported = (
      await call('PUT', '/v1/me/feed-prefs', alice, { recipe: saved.recipe })
    ).json();
    expect(imported.mutedCommunities).toEqual(['education']);
    expect(
      (await call('PUT', '/v1/me/feed-prefs', alice, { recipe: 'not-a-recipe' })).statusCode,
    ).toBe(400);
  });
});

describe('Common Ground digest', () => {
  it('summarizes the week', async () => {
    const d = (await call('GET', '/v1/digest/common-ground')).json();
    expect(d).toHaveProperty('bills');
    expect(d).toHaveProperty('stories');
    expect(d.from < d.to).toBe(true);
  });
});

describe('organization page', () => {
  it('puts decisions to members; votes are advisory and private until you vote', async () => {
    expect(
      (
        await call('POST', '/v1/moderation/org/proposals', alice, {
          title: 'Add a dark mode',
          body: 'Should the app add a light/dark toggle soon?',
        })
      ).statusCode,
    ).toBe(403);
    const id = (
      await call('POST', '/v1/moderation/org/proposals', mod, {
        title: 'Publish quarterly transparency reports',
        body: 'Should Demanity publish moderation numbers every quarter?',
      })
    ).json().id;
    const before = (await call('GET', '/v1/org/proposals', alice)).json();
    expect(before.threshold).toBe(100);
    expect(before.proposals[0].tally).toBeNull();
    expect(
      (await call('POST', `/v1/org/proposals/${id}/vote`, alice, { stance: 'support' })).statusCode,
    ).toBe(201);
    expect(
      (await call('POST', `/v1/org/proposals/${id}/vote`, alice, { stance: 'oppose' })).statusCode,
    ).toBe(409);
    expect((await call('GET', '/v1/org/proposals', alice)).json().proposals[0].tally).toEqual({
      support: 1,
      oppose: 0,
    });
    expect(
      (
        await call('POST', `/v1/moderation/org/proposals/${id}/respond`, mod, {
          response: 'Yes: the first report ships in Q1, with the template public now.',
        })
      ).json(),
    ).toEqual({ status: 'responded' });
  });
});
