import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, moderator, onboard, signIn, type Harness } from './harness.js';

let h: Harness;
let alice: string;
let bob: string;
let mod: string;
let mod2: string;

beforeAll(async () => {
  h = await createHarness();
  alice = (await signIn(h, (await onboard(h, 'alice')).device)).json().token;
  bob = (await signIn(h, (await onboard(h, 'bob')).device)).json().token;
  mod = await moderator(h, 'mod_one');
  mod2 = await moderator(h, 'mod_two');
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

async function newPost(token: string, title = 'Clinic hours are changing') {
  return (
    await call('POST', '/v1/communities/health/posts', token, { title, body: 'Details here.' })
  ).json().id as string;
}

describe('/v1/me', () => {
  it('tells the app whether the user is a moderator', async () => {
    expect((await call('GET', '/v1/me', mod)).json().moderator).toBe(true);
    expect((await call('GET', '/v1/me', alice)).json().moderator).toBe(false);
  });
});

describe('context notes', () => {
  it('lets moderators add sourced, labeled notes that anyone can read', async () => {
    const postId = await newPost(alice);
    const base = {
      targetType: 'post',
      targetId: postId,
      body: 'The new hours start next month, not this week.',
      reasonCode: 'missing_context',
    };
    expect(
      (
        await call('POST', '/v1/moderation/context-notes', alice, {
          ...base,
          sourceUrl: 'https://www.cdc.gov/x',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('POST', '/v1/moderation/context-notes', mod, {
          ...base,
          sourceUrl: 'https://random-blog.example/x',
        })
      ).json().error,
    ).toBe('source_not_approved');
    expect(
      (
        await call('POST', '/v1/moderation/context-notes', mod, {
          ...base,
          sourceUrl: 'https://www.cdc.gov/x',
        })
      ).statusCode,
    ).toBe(201);
    const notes = (await call('GET', `/v1/context-notes?targetType=post&targetId=${postId}`)).json()
      .notes;
    expect(notes).toEqual([
      expect.objectContaining({ body: base.body, sourceName: 'U.S. government (.gov) sites' }),
    ]);
    expect(notes[0]).not.toHaveProperty('authorId');
  });
});

describe('removal and appeals', () => {
  it('removes a comment, and a different moderator decides the author’s appeal', async () => {
    const postId = await newPost(bob, 'Thread for appeals');
    const comment = (
      await call('POST', `/v1/posts/${postId}/comments`, alice, { body: 'A comment' })
    ).json().id;
    expect(
      (
        await call('POST', `/v1/moderation/comments/${comment}/remove`, mod, { reasonCode: 'spam' })
      ).json(),
    ).toEqual({ status: 'removed' });

    // Only the author can appeal.
    const statement = 'This was not spam; it was a reply to the post.';
    expect(
      (
        await call('POST', '/v1/appeals', bob, {
          targetType: 'comment',
          targetId: comment,
          statement,
        })
      ).json().error,
    ).toBe('only_the_author_can_appeal');
    const appeal = (
      await call('POST', '/v1/appeals', alice, {
        targetType: 'comment',
        targetId: comment,
        statement,
      })
    ).json();
    expect(appeal.status).toBe('pending');

    // The moderator who removed it can't decide the appeal.
    const queue = (await call('GET', '/v1/moderation/appeals', mod)).json().appeals;
    expect(queue.find((a: { id: string }) => a.id === appeal.id).yourDecision).toBe(true);
    expect(
      (
        await call('POST', `/v1/moderation/appeals/${appeal.id}/decision`, mod, {
          decision: 'uphold',
          reasonCode: 'removal_not_justified',
        })
      ).json().error,
    ).toBe('cannot_decide_own_case');
    expect(
      (
        await call('POST', `/v1/moderation/appeals/${appeal.id}/decision`, mod2, {
          decision: 'uphold',
          reasonCode: 'removal_not_justified',
        })
      ).json(),
    ).toEqual({ status: 'upheld' });

    const comments = (await call('GET', `/v1/posts/${postId}/comments`)).json().comments;
    expect(comments[0]).toMatchObject({ status: 'visible', body: 'A comment' });
    expect((await call('GET', '/v1/me/appeals', alice)).json().appeals[0]).toMatchObject({
      status: 'upheld',
      reasonCode: 'removal_not_justified',
    });
  });
});

describe('slow mode', () => {
  it('limits each person to one comment per 2 minutes in a heated thread', async () => {
    const postId = await newPost(bob, 'A heated thread');
    // 20 recent comments make the thread "heated".
    await h.apiPool.query(
      `INSERT INTO comments (post_id, author_id, body)
       SELECT $1, (SELECT id FROM accounts WHERE username = 'bob'), 'x' FROM generate_series(1, 20)`,
      [postId],
    );
    expect(
      (await call('POST', `/v1/posts/${postId}/comments`, alice, { body: 'first' })).statusCode,
    ).toBe(201);
    const second = await call('POST', `/v1/posts/${postId}/comments`, alice, { body: 'second' });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: 'slow_mode', retryAfterSeconds: 120 });
  });
});
