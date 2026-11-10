import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, type Pool } from '@demanity/db';
import { createTempDatabase } from '@demanity/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiBudget,
  BudgetExhausted,
  COURTLISTENER_BUDGET,
  OPENSTATES_BUDGET,
} from '../src/ingest/budget.js';
import { statusFromAction } from '../src/ingest/congress.js';
import {
  caseCitation,
  CourtListenerClient,
  inMaintenanceWindow,
  syncRulings,
} from '../src/ingest/courtlistener.js';
import { OpenStatesClient, syncStateBills } from '../src/ingest/openstates.js';

/**
 * Open States and CourtListener adapters against fake APIs whose shapes
 * follow the providers' own docs/source (see the adapter headers).
 */

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

const noWait = async () => {};

describe('multi-window budgets match the published limits', () => {
  it('our budgets are at most half of each provider limit', () => {
    // Open States default tier: 10/min, 250/day. CourtListener: 5/min, 50/h, 125/day.
    expect(OPENSTATES_BUDGET.perMinute! * 2).toBeLessThanOrEqual(10);
    expect(OPENSTATES_BUDGET.perDay! * 2).toBeLessThanOrEqual(250);
    expect(COURTLISTENER_BUDGET.perMinute! * 2).toBeLessThanOrEqual(5);
    expect(COURTLISTENER_BUDGET.perHour! * 2).toBeLessThanOrEqual(50);
    expect(COURTLISTENER_BUDGET.perDay! * 2).toBeLessThanOrEqual(125);
  });

  it('refuses when any window is full and counts nothing in the others', async () => {
    const b = new ApiBudget(pool, 'multi', { perMinute: 2, perDay: 100, minIntervalMs: 0 }, noWait);
    await b.take();
    await b.take();
    const err = await b.take().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExhausted);
    expect((err as BudgetExhausted).window).toBe('minute');
    expect(await b.used('day')).toBe(2); // the refused call didn't count
  });
});

describe('Open States state bills', () => {
  const BILL = {
    id: 'ocd-bill/0001',
    session: '20252026',
    identifier: 'AB 12',
    title: 'Clinic hours',
    openstates_url: 'https://openstates.org/ca/bills/20252026/AB12/',
    first_action_date: '2026-01-05',
    latest_action_date: '2026-10-01',
    latest_action_description: 'Chaptered by Secretary of State. Chapter 101, Statutes of 2026.',
    updated_at: '2026-11-09T10:00:00+00:00',
    abstracts: [{ abstract: 'Extends clinic hours.' }],
    sponsorships: [
      {
        name: 'Rivera',
        primary: true,
        classification: 'author',
        person: {
          id: 'ocd-person/aaaa-bbbb-cccc-dddd',
          name: 'Ana Rivera',
          party: 'Democratic',
          current_role: { title: 'Assemblymember', org_classification: 'lower', district: '12' },
        },
      },
    ],
  };

  it('sends the key in the X-API-KEY header and stores bills with provenance and sponsors', async () => {
    const seen: Array<{ url: string; key: string | null }> = [];
    const fake = (async (input: string, init?: RequestInit) => {
      seen.push({ url: input, key: new Headers(init?.headers).get('X-API-KEY') });
      return Response.json({
        results: new URL(input).searchParams.get('jurisdiction') === 'California' ? [BILL] : [],
        pagination: { per_page: 20, page: 1, max_page: 1, total_items: 1 },
      });
    }) as unknown as typeof fetch;
    const budget = new ApiBudget(pool, 'openstates', OPENSTATES_BUDGET, noWait);
    const r = await syncStateBills(pool, new OpenStatesClient('os-key', fake, budget), {
      now: new Date('2026-11-10T12:00:00Z'),
      states: ['california', 'texas'],
    });
    expect(r).toMatchObject({ bills: 1, leaders: 1, stoppedEarly: null });
    expect(seen[0]!.key).toBe('os-key');
    expect(seen[0]!.url).not.toContain('os-key'); // key never in the URL
    const u = new URL(seen[0]!.url);
    expect(u.searchParams.getAll('include')).toEqual(['sponsorships', 'abstracts']);
    expect(u.searchParams.get('per_page')).toBe('20');
    const { rows } = await pool.query(
      `SELECT b.number, b.status, b.summary, b.source_url, p.slug AS place, l.name, l.office_kind
         FROM bills b JOIN places p ON p.id = b.place_id
         JOIN bill_sponsors s ON s.bill_id = b.id JOIN leaders l ON l.id = s.leader_id
        WHERE b.source = 'openstates'`,
    );
    expect(rows).toEqual([
      {
        number: 'AB 12 (20252026)',
        status: 'signed',
        summary: 'Extends clinic hours.',
        source_url: BILL.openstates_url,
        place: 'california',
        name: 'Ana Rivera',
        office_kind: 'state_house',
      },
    ]);
  });

  it('stops all states once the budget is used up', async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return Response.json({ results: [], pagination: { page: 1, max_page: 1, total_items: 0 } });
    }) as unknown as typeof fetch;
    const budget = new ApiBudget(pool, 'os-tiny', { perDay: 1, minIntervalMs: 0 }, noWait);
    const r = await syncStateBills(pool, new OpenStatesClient('k', fake, budget));
    expect(calls).toBe(1);
    expect(r.stoppedEarly).toMatch(/budget used up/);
  });

  it('reads state wording for status', () => {
    expect(statusFromAction('Approved by the Governor.')).toBe('signed');
    expect(statusFromAction('Enrolled and presented to the Governor at 3 p.m.')).toBe('passed');
  });
});

describe('CourtListener rulings', () => {
  it('uses the documented token header and query operators, and stores rulings', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fake = (async (input: string, init?: RequestInit) => {
      seen.push({ url: input, auth: new Headers(init?.headers).get('Authorization') });
      const u = new URL(input);
      const court = /court_id:(\w+)/.exec(u.searchParams.get('q') ?? '')![1]!;
      if (u.searchParams.get('type') === 'd')
        return Response.json({
          count: 1,
          results: [
            {
              caseName: `Smith v. ${court}`,
              court_id: court,
              court_citation_string: court === 'cacd' ? 'C.D. Cal.' : undefined,
              dateFiled: '2026-11-10',
              docketNumber: '2:26-cv-13146',
              docket_id: 7000 + court.charCodeAt(0) + court.length,
              docket_absolute_url: `/docket/${court}/smith/`,
              cause: '28:1332 Diversity',
              suitNature: 'Contract',
              party: ['Private Person'],
              attorney: ['Some Lawyer'],
            },
          ],
        });
      return Response.json({
        count: 1,
        results: [
          {
            caseName: `Doe v. ${court}`,
            court_id: court,
            dateFiled: '2026-11-03',
            absolute_url: `/opinion/${court}1/doe-v-x/`,
            docketNumber: '2:26-cv-1',
            cluster_id: court.length * 1000 + court.charCodeAt(0),
          },
        ],
      });
    }) as unknown as typeof fetch;
    // Without real 30 s spacing all calls land in one minute, so test the adapter
    // with the daily window only (the per-minute window is tested above).
    const budget = new ApiBudget(
      pool,
      'courtlistener',
      { perDay: COURTLISTENER_BUDGET.perDay!, minIntervalMs: 0 },
      noWait,
    );
    const r = await syncRulings(pool, new CourtListenerClient('cl-token', fake, budget), {
      now: new Date('2026-11-10T18:00:00Z'), // a Tuesday
    });
    expect(r).toEqual({ rulings: 5, dockets: 5, stoppedEarly: null });
    expect(seen).toHaveLength(10); // 2 searches per court
    expect(new URL(seen[0]!.url).searchParams.get('type')).toBe('d');
    expect(seen[0]!.auth).toBe('Token cl-token');
    expect(new URL(seen[0]!.url).searchParams.get('order_by')).toBe('dateFiled desc');
    expect(new URL(seen[0]!.url).searchParams.get('q')).toBe('court_id:cacd');
    const { rows } = await pool.query("SELECT url FROM court_rulings WHERE court_id = 'cacd'");
    expect(rows[0].url).toBe('https://www.courtlistener.com/opinion/cacd1/doe-v-x/');
    const { rows: filings } = await pool.query(
      "SELECT url, court_citation, cause, nature_of_suit FROM court_dockets WHERE court_id = 'cacd'",
    );
    expect(filings[0]).toEqual({
      url: 'https://www.courtlistener.com/docket/cacd/smith/',
      court_citation: 'C.D. Cal.',
      cause: '28:1332 Diversity',
      nature_of_suit: 'Contract',
    });
    // Falls back to the Bluebook abbreviation when the result has none.
    const { rows: tx } = await pool.query(
      "SELECT court_citation FROM court_dockets WHERE court_id = 'txsd'",
    );
    expect(tx[0].court_citation).toBe('S.D. Tex.');
    // Party and attorney names are never stored.
    const { rows: cols } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'court_dockets'",
    );
    expect(cols.map((c) => c.column_name)).not.toEqual(expect.arrayContaining(['party']));
    expect(cols.map((c) => c.column_name).some((c) => /party|attorney|firm/.test(c))).toBe(false);
  });

  it('stops cleanly, without an error, when the provider is temporarily down (502)', async () => {
    let calls = 0;
    const down = (async () => {
      calls++;
      return new Response('Bad Gateway', { status: 502 });
    }) as unknown as typeof fetch;
    const r = await syncRulings(pool, new CourtListenerClient('t', down), {
      now: new Date('2026-11-10T18:00:00Z'),
    });
    expect(calls).toBe(1);
    expect(r.stoppedEarly).toMatch(/temporarily unavailable \(HTTP 502\)/);
    const { rows } = await pool.query(
      "SELECT last_error FROM sync_state WHERE source = 'courtlistener'",
    );
    expect(rows[0].last_error).toBeNull();
  });

  it('formats Bluebook-style citations', () => {
    expect(
      caseCitation({
        caseName: 'Juarez v. Propper International Sales, Inc.',
        docketNumber: '2:26-cv-13146',
        courtCitation: 'C.D. Cal.',
        date: '2026-11-10',
        filed: true,
      }),
    ).toBe(
      'Juarez v. Propper International Sales, Inc., No. 2:26-cv-13146 (C.D. Cal. filed Nov. 10, 2026)',
    );
    expect(
      caseCitation({
        caseName: "Borchenko v. L'Oreal USA, Inc.",
        docketNumber: 'Case No. 2:19-cv-01427-R-AS',
        courtCitation: 'C.D. Cal.',
        date: '2019-09-03',
        filed: false,
      }),
    ).toBe("Borchenko v. L'Oreal USA, Inc., No. 2:19-cv-01427-R-AS (C.D. Cal. Sept. 3, 2019)");
  });

  it('never calls during the weekly maintenance window (Thu 21:00-23:59 Pacific)', async () => {
    // 2026-11-12 is a Thursday; 05:30 UTC Friday = 21:30 Thursday Pacific (PST, UTC-8).
    expect(inMaintenanceWindow(new Date('2026-11-13T05:30:00Z'))).toBe(true);
    expect(inMaintenanceWindow(new Date('2026-11-13T09:00:00Z'))).toBe(false);
    let calls = 0;
    const fake = (async () => {
      calls++;
      return Response.json({ results: [] });
    }) as unknown as typeof fetch;
    const r = await syncRulings(pool, new CourtListenerClient('t', fake), {
      now: new Date('2026-11-13T05:30:00Z'),
    });
    expect(calls).toBe(0);
    expect(r.stoppedEarly).toMatch(/maintenance/);
  });
});
