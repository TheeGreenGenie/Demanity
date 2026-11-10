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
  mod = await moderator(h, 'mod_social');
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

async function post(token: string, community: string, title: string, body = 'Body text') {
  const res = await call('POST', `/v1/communities/${community}/posts`, token, { title, body });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

describe('communities', () => {
  it('lists seeded reference communities to guests, Humanity first', async () => {
    const { communities } = (await call('GET', '/v1/communities')).json();
    expect(communities[0]).toMatchObject({ slug: 'humanity', kind: 'humanity' });
    expect(communities.filter((c: { kind: string }) => c.kind === 'topic')).toHaveLength(32);
    expect(communities.map((c: { slug: string }) => c.slug)).toEqual(
      expect.arrayContaining([
        'california',
        'texas',
        'florida',
        'new-york',
        'pennsylvania',
        'united-states',
      ]),
    );
  });
});

describe('posts and comments', () => {
  it('lets members post and guests read; guests cannot write', async () => {
    const { id } = await post(alice, 'health', 'Clinic hours expanded');
    const guestRead = await call('GET', `/v1/posts/${id}`);
    expect(guestRead.json()).toMatchObject({
      title: 'Clinic hours expanded',
      author: { username: 'alice' },
      community: { slug: 'health' },
      counts: { like: 0, dislike: 0, comments: 0 },
      myReaction: null,
    });
    const guestWrite = await call('POST', '/v1/communities/health/posts', null, {
      title: 'Nope',
      body: 'x',
    });
    expect(guestWrite.statusCode).toBe(401);
  });

  it('threads comments under a post', async () => {
    const { id } = await post(alice, 'education', 'School board update');
    const top = (
      await call('POST', `/v1/posts/${id}/comments`, bob, { body: 'Thanks for sharing' })
    ).json();
    const reply = await call('POST', `/v1/posts/${id}/comments`, alice, {
      body: 'Glad it helps',
      parentId: top.id,
    });
    expect(reply.statusCode).toBe(201);
    const { comments } = (await call('GET', `/v1/posts/${id}/comments`)).json();
    expect(
      comments.map((c: { body: string; parentId: string | null }) => [c.body, c.parentId]),
    ).toEqual([
      ['Thanks for sharing', null],
      ['Glad it helps', top.id],
    ]);
    expect((await call('GET', `/v1/posts/${id}`)).json().counts.comments).toBe(2);
  });

  it('rejects a reply whose parent is on a different post', async () => {
    const a = await post(alice, 'energy', 'Grid upgrade');
    const b = await post(alice, 'energy', 'Solar rebates');
    const c = (await call('POST', `/v1/posts/${a.id}/comments`, bob, { body: 'On A' })).json();
    const res = await call('POST', `/v1/posts/${b.id}/comments`, bob, {
      body: 'Wrong thread',
      parentId: c.id,
    });
    expect(res.json()).toEqual({ error: 'parent_not_in_post' });
  });

  it('pages community posts newest-first with a cursor', async () => {
    for (let i = 0; i < 22; i++)
      await post(bob, 'transportation-and-public-works', `Road report ${i}`);
    const first = (
      await call('GET', '/v1/communities/transportation-and-public-works/posts')
    ).json();
    expect(first.posts).toHaveLength(20);
    expect(first.posts[0].title).toBe('Road report 21');
    const second = (
      await call(
        'GET',
        `/v1/communities/transportation-and-public-works/posts?cursor=${first.next}`,
      )
    ).json();
    expect(second.posts.map((p: { title: string }) => p.title)).toEqual([
      'Road report 1',
      'Road report 0',
    ]);
    expect(second.next).toBeNull();
  });
});

describe('reactions', () => {
  it('allows like/dislike in topic communities, one reaction per person', async () => {
    const { id } = await post(alice, 'taxation', 'Property tax change');
    await call('PUT', '/v1/reactions', bob, { targetType: 'post', targetId: id, kind: 'like' });
    await call('PUT', '/v1/reactions', bob, { targetType: 'post', targetId: id, kind: 'dislike' }); // switches
    const view = (await call('GET', `/v1/posts/${id}`, bob)).json();
    expect(view.counts).toMatchObject({ like: 0, dislike: 1 });
    expect(view.myReaction).toBe('dislike');
    expect(
      (await call('PUT', '/v1/reactions', bob, { targetType: 'post', targetId: id, kind: 'kudos' }))
        .statusCode,
    ).toBe(400);
  });

  it('makes Humanity kudos-only, with no dislikes', async () => {
    const { id } = await post(alice, 'humanity', 'Neighbors shoveled every driveway');
    const dislike = await call('PUT', '/v1/reactions', bob, {
      targetType: 'post',
      targetId: id,
      kind: 'dislike',
    });
    expect(dislike.json()).toMatchObject({
      error: 'reaction_not_allowed_here',
      allowed: ['kudos'],
    });
    expect(
      (await call('PUT', '/v1/reactions', bob, { targetType: 'post', targetId: id, kind: 'kudos' }))
        .statusCode,
    ).toBe(204);
    expect((await call('GET', `/v1/posts/${id}`)).json().counts.kudos).toBe(1);
  });
});

describe('follows and feed', () => {
  it('shows only followed communities and people, newest first, each with a reason', async () => {
    const fresh = (await signIn(h, (await onboard(h, 'carol')).device)).json().token;
    // Nothing followed: recent posts across Demanity, labelled as such.
    const empty = (await call('GET', '/v1/feed', fresh)).json();
    expect(empty.posts[0].reason).toMatch(/you follow nothing yet/);

    await call('PUT', '/v1/follows/community/immigration', fresh);
    await call('PUT', '/v1/follows/user/bob', fresh);
    await post(alice, 'immigration', 'Visa processing times');
    await post(bob, 'law', 'Court backlog');
    await post(alice, 'law', 'Not followed');

    const { posts } = (await call('GET', '/v1/feed', fresh)).json();
    expect(
      posts.slice(0, 2).map((p: { title: string; reason: string }) => [p.title, p.reason]),
    ).toEqual([
      ['Court backlog', 'You follow @bob'],
      ['Visa processing times', 'You follow Immigration'],
    ]);
    expect(posts.map((p: { title: string }) => p.title)).not.toContain('Not followed');

    await call('DELETE', '/v1/follows/user/bob', fresh);
    const after = (await call('GET', '/v1/feed', fresh)).json();
    expect(after.posts.map((p: { title: string }) => p.title)).not.toContain('Court backlog');
  });

  it('refuses self-follows and guest feeds', async () => {
    expect((await call('PUT', '/v1/follows/user/alice', alice)).json()).toEqual({
      error: 'cannot_follow_self',
    });
    expect((await call('GET', '/v1/feed')).statusCode).toBe(401);
  });

  it('shows public profiles with minimal disclosure', async () => {
    const profile = (await call('GET', '/v1/users/alice')).json();
    expect(profile.username).toBe('alice');
    expect(profile.joined).toMatch(/^\d{4}-\d{2}$/); // month only
    expect(profile.posts.length).toBeGreaterThan(0);
  });
});

describe('moderator removal', () => {
  it('removes clear violations with a published reason, logged publicly', async () => {
    const { id } = await post(bob, 'commerce', 'Buy followers cheap!!!');
    expect(
      (await call('POST', `/v1/moderation/posts/${id}/remove`, alice, { reasonCode: 'spam' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('POST', `/v1/moderation/posts/${id}/remove`, mod, { reasonCode: 'i_disagree' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('POST', `/v1/moderation/posts/${id}/remove`, mod, { reasonCode: 'spam' })).json(),
    ).toEqual({
      status: 'removed',
    });

    const view = (await call('GET', `/v1/posts/${id}`)).json();
    expect(view).toMatchObject({
      status: 'removed',
      title: '[removed]',
      body: null,
      removedReason: 'spam',
    });
    expect(
      (await call('POST', `/v1/posts/${id}/comments`, alice, { body: 'late' })).json(),
    ).toEqual({ error: 'post_removed' });
    const log = (await call('GET', '/v1/moderation/log')).json().entries;
    expect(log[0]).toMatchObject({ action: 'post.removed', reason_code: 'spam' });
  });

  it('stops moderators removing their own posts', async () => {
    const { id } = await post(mod, 'law', 'My own post');
    expect(
      (await call('POST', `/v1/moderation/posts/${id}/remove`, mod, { reasonCode: 'spam' })).json(),
    ).toEqual({
      error: 'cannot_decide_own_case',
    });
    expect((await call('GET', `/v1/posts/${id}`)).json().status).toBe('visible');
  });
});
