import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteStalePendingAccounts } from '../src/moderation/service.js';
import {
  bearer,
  createHarness,
  identity,
  moderator,
  onboard,
  RP,
  signIn,
  type Harness,
} from './harness.js';
import { SoftAuthenticator } from './soft-authenticator.js';

let h: Harness;
let mod: string;

beforeAll(async () => {
  h = await createHarness();
  mod = await moderator(h, 'mod_alice');
});

afterAll(async () => {
  await h?.close();
});

const post = (url: string, token: string | null, payload?: Record<string, unknown>) => {
  const options: InjectOptions = { method: 'POST', url };
  if (token) options.headers = bearer(token);
  if (payload !== undefined) options.payload = payload;
  return h.app.inject(options);
};

describe('moderator access', () => {
  it('rejects guests and regular users from moderator routes', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/moderation/reviews' })).statusCode).toBe(
      401,
    );
    const { device } = await onboard(h, 'regular_bob');
    const bob = (await signIn(h, device)).json().token;
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/moderation/reviews',
      headers: bearer(bob),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'moderator_only' });
  });

  it('serves the public log and reason codes to guests', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/moderation/log' })).statusCode).toBe(200);
    const codes = (
      await h.app.inject({ method: 'GET', url: '/v1/moderation/reason-codes' })
    ).json();
    expect(codes.ban).toContain('account_sale');
  });
});

describe('verification review queue', () => {
  it('queues provider-undecided cases without storing identity data, then approves on re-submit', async () => {
    const token = (await post('/v1/accounts', null, { username: 'needs_review' })).json().token;
    const person = identity({ licenseNumber: 'REVIEW0001' });
    const first = await post('/v1/me/verification', token, person);
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ status: 'pending', review: 'moderator_queue' });

    const dump = JSON.stringify((await h.apiPool.query('SELECT * FROM verification_reviews')).rows);
    expect(dump).not.toContain('REVIEW0001');

    const queue = (
      await h.app.inject({ method: 'GET', url: '/v1/moderation/reviews', headers: bearer(mod) })
    ).json();
    const item = queue.reviews.find((r: { username: string }) => r.username === 'needs_review');
    expect(item).toBeDefined();

    // While pending, re-submitting just reports pending.
    expect((await post('/v1/me/verification', token, person)).statusCode).toBe(202);

    // A reason code must match the decision.
    const mismatch = await post(`/v1/moderation/reviews/${item.account_id}/decision`, mod, {
      decision: 'approve',
      reasonCode: 'suspected_fraud',
    });
    expect(mismatch.json()).toEqual({ error: 'reason_does_not_match_decision' });

    const ok = await post(`/v1/moderation/reviews/${item.account_id}/decision`, mod, {
      decision: 'approve',
      reasonCode: 'manual_document_review',
    });
    expect(ok.json()).toEqual({ status: 'approved' });

    const after = await post('/v1/me/verification', token, person);
    expect(after.json()).toEqual({ status: 'verified' });

    const log = (await h.app.inject({ method: 'GET', url: '/v1/moderation/log' })).json().entries;
    const entry = log.find((e: { action: string }) => e.action === 'verification.approved');
    expect(entry).toMatchObject({
      reason_code: 'manual_document_review',
      actor_role: 'moderator',
      target_username: null,
    });
    expect(entry).not.toHaveProperty('actor_account_id'); // moderator identity stays private
  });

  it('denials block further attempts', async () => {
    const token = (await post('/v1/accounts', null, { username: 'denied_one' })).json().token;
    await post('/v1/me/verification', token, identity({ licenseNumber: 'REVIEW0002' }));
    const { account_id } = (
      await h.apiPool.query(
        "SELECT account_id FROM verification_reviews r JOIN accounts a ON a.id = r.account_id WHERE a.username = 'denied_one'",
      )
    ).rows[0];
    await post(`/v1/moderation/reviews/${account_id}/decision`, mod, {
      decision: 'deny',
      reasonCode: 'document_unreadable',
    });
    const res = await post('/v1/me/verification', token, identity());
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'verification_denied', reason: 'document_unreadable' });
  });
});

describe('bans', () => {
  it('bans permanently: sessions end, passkeys stop, and the person cannot re-register', async () => {
    const person = identity();
    const { device } = await onboard(h, 'to_be_banned', person);
    const session = (await signIn(h, device)).json().token;

    const ban = await post('/v1/moderation/accounts/to_be_banned/ban', mod, {
      reasonCode: 'account_sale',
    });
    expect(ban.json()).toEqual({ status: 'banned' });

    expect(
      (await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(session) })).statusCode,
    ).toBe(401);
    expect((await signIn(h, device)).statusCode).toBe(400);

    const fresh = (await post('/v1/accounts', null, { username: 'ban_evader' })).json().token;
    const retry = await post('/v1/me/verification', fresh, person);
    expect(retry.statusCode).toBe(403);
    expect(retry.json()).toEqual({ error: 'banned' });

    const log = (await h.app.inject({ method: 'GET', url: '/v1/moderation/log' })).json().entries;
    expect(log[0]).toMatchObject({
      action: 'account.banned',
      target_username: 'to_be_banned',
      reason_code: 'account_sale',
    });
  });

  it('requires a published reason code and blocks self-moderation', async () => {
    await onboard(h, 'some_user');
    expect(
      (await post('/v1/moderation/accounts/some_user/ban', mod, { reasonCode: 'i_dont_like_them' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post('/v1/moderation/accounts/mod_alice/ban', mod, { reasonCode: 'spam' })).json(),
    ).toEqual({
      error: 'cannot_decide_own_case',
    });
  });

  it('keeps the moderation log append-only', async () => {
    await expect(h.apiPool.query('DELETE FROM moderation_log')).rejects.toThrow(/append-only/);
  });
});

describe('assisted recovery (device and 2FA both lost)', () => {
  it('needs moderator approval plus a matching identity, and is single use', async () => {
    const person = identity();
    const { device: lost } = await onboard(h, 'lost_everything', person);

    // Without approval, re-verification fails.
    const early = await post('/v1/auth/recovery/reverify', null, {
      username: 'lost_everything',
      state: person.state,
      licenseNumber: person.licenseNumber,
    });
    expect(early.json()).toEqual({ error: 'recovery_not_possible' });

    expect(
      (await post('/v1/auth/recovery/request', null, { username: 'lost_everything' })).statusCode,
    ).toBe(202);

    // A filed but not-yet-approved request must not unlock anything.
    const pending = await post('/v1/auth/recovery/reverify', null, {
      username: 'lost_everything',
      state: person.state,
      licenseNumber: person.licenseNumber,
    });
    expect(pending.json()).toEqual({ error: 'recovery_not_possible' });

    const { requests } = (
      await h.app.inject({
        method: 'GET',
        url: '/v1/moderation/recovery-requests',
        headers: bearer(mod),
      })
    ).json();
    const req = requests.find((r: { username: string }) => r.username === 'lost_everything');
    await post(`/v1/moderation/recovery-requests/${req.id}/decision`, mod, {
      decision: 'approve',
      reasonCode: 'ownership_plausible',
    });

    // Someone else's identity does not unlock the account.
    const stranger = await post('/v1/auth/recovery/reverify', null, {
      username: 'lost_everything',
      state: 'PA',
      licenseNumber: 'P9999999zz',
    });
    expect(stranger.json()).toEqual({ error: 'recovery_not_possible' });

    // A wrong guess above did not consume the approval, but the right identity does.
    const ok = await post('/v1/auth/recovery/reverify', null, {
      username: 'lost_everything',
      state: person.state,
      licenseNumber: person.licenseNumber,
    });
    const recovery = ok.json().token as string;
    expect(recovery).toBeTruthy();

    const replay = await post('/v1/auth/recovery/reverify', null, {
      username: 'lost_everything',
      state: person.state,
      licenseNumber: person.licenseNumber,
    });
    expect(replay.json()).toEqual({ error: 'recovery_not_possible' });

    const fresh = new SoftAuthenticator(RP.id, RP.origins[0]!);
    const options = (await post('/v1/me/passkeys/options', recovery)).json();
    expect(
      (await post('/v1/me/passkeys', recovery, { response: fresh.register(options) })).statusCode,
    ).toBe(201);
    expect((await signIn(h, fresh)).statusCode).toBe(200);
    expect((await signIn(h, lost)).statusCode).toBe(400);
  });

  it('does not reveal whether a username exists', async () => {
    const res = await post('/v1/auth/recovery/request', null, { username: 'no_such_user' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'if_account_exists_request_filed' });
  });
});

describe('pending-account cleanup', () => {
  it('frees usernames held by stale unverified sign-ups, but keeps accounts under review', async () => {
    await post('/v1/accounts', null, { username: 'squatter' });
    await h.apiPool.query(
      "UPDATE accounts SET created_at = now() - interval '25 hours' WHERE username IN ('squatter', 'needs_review_old')",
    );
    const reviewed = (await post('/v1/accounts', null, { username: 'under_review' })).json().token;
    await post('/v1/me/verification', reviewed, identity({ licenseNumber: 'REVIEW0003' }));
    await h.apiPool.query(
      "UPDATE accounts SET created_at = now() - interval '25 hours' WHERE username = 'under_review'",
    );

    expect(await deleteStalePendingAccounts(h.apiPool)).toBeGreaterThanOrEqual(1);
    const names = (await h.apiPool.query('SELECT username FROM accounts')).rows.map(
      (r) => r.username,
    );
    expect(names).not.toContain('squatter');
    expect(names).toContain('under_review');
    expect((await post('/v1/accounts', null, { username: 'squatter' })).statusCode).toBe(201);
  });
});
