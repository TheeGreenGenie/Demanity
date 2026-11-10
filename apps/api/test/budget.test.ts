import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, type Pool } from '@demanity/db';
import { createTempDatabase } from '@demanity/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiBudget, BudgetExhausted, ingestCaps } from '../src/ingest/budget.js';
import { CongressClient, syncCongressBills } from '../src/ingest/congress.js';

const here = dirname(fileURLToPath(import.meta.url));
let pool: Pool;
let drop: () => Promise<void>;

beforeAll(async () => {
  const db = await createTempDatabase();
  drop = db.drop;
  pool = createPool(db.url);
  await migrate(pool, join(here, '..', 'migrations'));
});
afterAll(async () => {
  await pool?.end();
  await drop?.();
});

const item = (n: number) => ({
  congress: 119,
  type: 'HR',
  number: String(n),
  title: `Bill ${n}`,
  latestAction: { actionDate: '2026-11-01', text: 'Referred to the Committee on Rules.' },
  updateDate: `2026-11-0${n}`,
});

/** Fake Congress.gov: a list of N bills and details for each, counting calls. */
function fakeApi(n: number, opts: { tooMany?: boolean } = {}) {
  let calls = 0;
  const fn = (async (input: string) => {
    calls++;
    if (opts.tooMany) return new Response('{}', { status: 429 });
    const url = new URL(input);
    if (url.pathname === '/v3/bill') {
      const limit = Number(url.searchParams.get('limit'));
      return Response.json({
        bills: Array.from({ length: Math.min(n, limit) }, (_, i) => item(i + 1)),
        pagination: {},
      });
    }
    if (url.pathname.endsWith('/actions')) return Response.json({ actions: [] });
    if (url.pathname.endsWith('/summaries')) return Response.json({ summaries: [] });
    const num = Number(url.pathname.split('/').pop());
    return Response.json({ bill: { ...item(num), sponsors: [] } });
  }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
}

describe('ApiBudget', () => {
  it('allows at most perHour requests per clock hour, shared through the database', async () => {
    const a = new ApiBudget(pool, 'test-src', { perHour: 3, minIntervalMs: 0 });
    const b = new ApiBudget(pool, 'test-src', { perHour: 3, minIntervalMs: 0 }); // another process
    await a.take();
    await b.take();
    await a.take();
    await expect(b.take()).rejects.toBeInstanceOf(BudgetExhausted);
    expect(await a.usedThisHour()).toBe(3);
  });

  it('spaces requests at least minIntervalMs apart', async () => {
    let t = 1_000;
    const waits: number[] = [];
    const budget = new ApiBudget(
      pool,
      'spacing',
      { perHour: 100, minIntervalMs: 1000 },
      async (ms) => {
        waits.push(ms);
        t += ms;
      },
      () => t,
    );
    await budget.take();
    t += 200;
    await budget.take();
    expect(waits).toEqual([800]);
  });
});

describe('ingest caps', () => {
  it('keeps development runs small and production bounded', () => {
    expect(ingestCaps('development', {})).toMatchObject({
      maxBillsPerRun: 25,
      lookbackDays: 3,
      congressPerHour: 500,
    });
    expect(ingestCaps('production', {}).maxBillsPerRun).toBe(500);
    // Never more than half the provider's documented 5,000/hour, even if misconfigured.
    expect(ingestCaps('production', { CONGRESS_REQUESTS_PER_HOUR: '99999' }).congressPerHour).toBe(
      2500,
    );
  });
});

describe('sync under a budget', () => {
  it('stops cleanly when the hour’s budget is used up and resumes later', async () => {
    const api = fakeApi(5);
    // Budget for the list request + bill 1 (detail, actions, summaries) + bill 2's detail.
    const budget = new ApiBudget(pool, 'congress.gov', { perHour: 5, minIntervalMs: 0 });
    const client = new CongressClient('k', api.fn, budget);
    const now = new Date('2026-11-10T12:00:00Z');
    const r = await syncCongressBills(pool, client, {
      now,
      since: new Date('2026-11-01T00:00:00Z'),
    });
    expect(r.bills).toBe(2);
    expect(r.stoppedEarly).toMatch(/budget used up/);
    expect(api.calls()).toBe(5); // never exceeded the budget
    const { rows } = await pool.query(
      "SELECT synced_through, last_error FROM sync_state WHERE source = 'congress.gov'",
    );
    expect(rows[0].last_error).toBeNull();
    expect(rows[0].synced_through.toISOString().slice(0, 10)).toBe('2026-11-02'); // resumes after bill 2
  });

  it('stops without retrying when the provider says 429', async () => {
    const api = fakeApi(5, { tooMany: true });
    const budget = new ApiBudget(pool, 'congress-429', { perHour: 100, minIntervalMs: 0 });
    const r = await syncCongressBills(pool, new CongressClient('k', api.fn, budget));
    expect(r.stoppedEarly).toMatch(/429/);
    expect(api.calls()).toBe(1);
  });
});
