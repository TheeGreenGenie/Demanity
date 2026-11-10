import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedSampleCivic } from '../dev/seed-sample-civic.js';
import { FederalRegisterClient, syncExecutiveOrders } from '../src/ingest/federalregister.js';
import { bearer, createHarness, moderator, onboard, signIn, type Harness } from './harness.js';

let h: Harness;
let alice: string;
let mod: string;
let billId: string;

beforeAll(async () => {
  h = await createHarness();
  alice = (await signIn(h, (await onboard(h, 'alice')).device)).json().token;
  mod = await moderator(h, 'mod_bills');
  await seedSampleCivic(h.apiPool);
  const { rows } = await h.apiPool.query<{ id: string }>(
    "SELECT b.id FROM bills b JOIN places p ON p.id = b.place_id WHERE p.slug = 'united-states' AND b.category_id IS NOT NULL LIMIT 1",
  );
  billId = rows[0]!.id;
  await h.apiPool.query(
    `INSERT INTO bill_actions (bill_id, seq, action_date, text, type) VALUES
       ($1, 0, '2026-10-02', 'Passed House.', 'Floor'), ($1, 1, '2026-09-01', 'Introduced in House', 'IntroReferral')`,
    [billId],
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

describe('bill pages', () => {
  it('shows the official timeline, newest first', async () => {
    const { actions } = (await call('GET', `/v1/bills/${billId}/timeline`)).json();
    expect(actions.map((a: { text: string }) => a.text)).toEqual([
      'Passed House.',
      'Introduced in House',
    ]);
  });

  it('hosts a discussion per bill, filed in the bill’s topic community', async () => {
    const res = await call('POST', `/v1/bills/${billId}/posts`, alice, {
      title: 'What would this change locally?',
      body: 'Curious how this affects our county.',
    });
    expect(res.statusCode).toBe(201);
    const { rows } = await h.apiPool.query(
      'SELECT c.id = b.category_id AS same FROM posts p JOIN bills b ON b.id = p.bill_id JOIN communities c ON c.id = p.community_id WHERE p.id = $1',
      [res.json().id],
    );
    expect(rows[0].same).toBe(true);
    const { posts } = (await call('GET', `/v1/bills/${billId}/posts`)).json();
    expect(posts[0].title).toBe('What would this change locally?');
  });
});

describe('executive orders (Federal Register)', () => {
  it('stores orders with a link to the official document', async () => {
    let seen = '';
    const fake = (async (input: string) => {
      seen = input;
      return Response.json({
        count: 1,
        results: [
          {
            document_number: '2026-22051',
            executive_order_number: '14438',
            title: 'Decreasing Housing Costs for the American People',
            signing_date: '2026-10-22',
            publication_date: '2026-10-28',
            html_url: 'https://www.federalregister.gov/documents/2026/10/28/2026-22051/x',
            abstract: null,
            president: { identifier: 'x', name: 'Donald Trump' },
          },
        ],
      });
    }) as unknown as typeof fetch;
    expect(await syncExecutiveOrders(h.apiPool, new FederalRegisterClient(fake))).toEqual({
      orders: 1,
      stoppedEarly: null,
    });
    const u = new URL(seen);
    expect(u.searchParams.getAll('conditions[presidential_document_type][]')).toEqual([
      'executive_order',
    ]);
    expect(u.searchParams.get('order')).toBe('newest');
    const { orders } = (await call('GET', '/v1/executive-orders')).json();
    expect(orders[0]).toMatchObject({
      number: '14438',
      signingDate: '2026-10-22',
      sourceName: 'Federal Register',
      url: expect.stringMatching(/^https:\/\/www\.federalregister\.gov\//),
    });
  });
});

describe('member contributions', () => {
  it('requires an approved source for missing items and publishes only after review', async () => {
    expect(
      (
        await call('POST', '/v1/contributions', alice, {
          kind: 'missing_item',
          title: 'Missing state bill on clinics',
          body: 'This bill was introduced last week but is not listed here.',
        })
      ).json().error,
    ).toBe('source_required');
    const idea = (
      await call('POST', '/v1/contributions', alice, {
        kind: 'bill_idea',
        title: 'Publish every state contract online',
        body: 'All state contracts over $10,000 should be searchable online.',
        category: 'government-operations-and-politics',
      })
    ).json().id;
    expect(
      (await call('GET', '/v1/contributions?kind=bill_idea')).json().contributions,
    ).toHaveLength(0);
    expect(
      (
        await call('POST', `/v1/moderation/contributions/${idea}/decision`, mod, {
          decision: 'accept',
          reasonCode: 'contribution_verified',
        })
      ).statusCode,
    ).toBe(200);
    await call('PUT', `/v1/contributions/${idea}/vote`, alice);
    const list = (await call('GET', '/v1/contributions?kind=bill_idea', alice)).json()
      .contributions;
    expect(list[0]).toMatchObject({
      title: 'Publish every state contract online',
      votes: 1,
      myVote: true,
    });
  });
});
