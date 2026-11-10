import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, type Pool } from '@demanity/db';
import { createTempDatabase } from '@demanity/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CongressClient,
  displayNumber,
  normalizeArea,
  ordinal,
  publicUrl,
  statusFromAction,
  syncCongressBills,
} from '../src/ingest/congress.js';

/**
 * The Congress.gov client against a fake API whose responses follow the
 * live shapes recorded on 2026-11-10 (see src/ingest/congress.ts).
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

const LIST = [
  {
    congress: 119,
    type: 'HR',
    number: '1',
    title: 'One Big Example Act',
    latestAction: { actionDate: '2025-07-04', text: 'Became Public Law No: 119-21.' },
    updateDate: '2026-11-09',
  },
  {
    congress: 119,
    type: 'S',
    number: '42',
    title: 'Clinic Access Act',
    latestAction: {
      actionDate: '2026-10-01',
      text: 'Read twice and referred to the Committee on Finance.',
    },
    updateDate: '2026-11-10',
  },
];
const DETAIL: Record<string, unknown> = {
  '/v3/bill/119/hr/1': {
    bill: {
      ...LIST[0],
      introducedDate: '2025-05-20',
      policyArea: { name: 'Economics and Public Finance' },
      updateDate: '2026-11-09T22:41:05Z',
      sponsors: [
        {
          bioguideId: 'X000001',
          fullName: 'Rep. Doe, Jane [R-TX-19]',
          firstName: 'Jane',
          lastName: 'Doe',
          party: 'R',
          state: 'TX',
          district: 19,
        },
      ],
    },
  },
  '/v3/bill/119/s/42': {
    bill: {
      ...LIST[1],
      introducedDate: '2026-09-30',
      policyArea: { name: 'Health' },
      updateDate: '2026-11-10T08:00:00Z',
      sponsors: [
        {
          bioguideId: 'Y000002',
          fullName: 'Sen. Roe, Sam [D-NY]',
          firstName: 'Sam',
          lastName: 'Roe',
          party: 'D',
          state: 'NY',
        },
      ],
    },
  },
};

function fakeApi() {
  const seen: string[] = [];
  const fn = (async (input: string) => {
    const url = new URL(input);
    seen.push(url.toString());
    if (url.searchParams.get('api_key') !== 'test-key') return new Response('{}', { status: 403 });
    if (url.pathname === '/v3/bill') {
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      const page = LIST.slice(offset, offset + limit);
      return Response.json({
        bills: page,
        pagination: {
          count: LIST.length,
          ...(offset + limit < LIST.length ? { next: 'more' } : {}),
        },
      });
    }
    if (url.pathname.endsWith('/actions'))
      return Response.json({
        actions: [
          {
            actionDate: '2026-10-01',
            text: 'Referred to the Committee on Finance.',
            type: 'IntroReferral',
          },
          { actionDate: '2026-09-30', text: 'Introduced in Senate', type: 'IntroReferral' },
        ],
      });
    if (url.pathname.endsWith('/summaries'))
      return Response.json({
        summaries: [
          {
            actionDate: '2026-09-30',
            text: '<p>Old &amp; outdated.</p>',
            updateDate: '2026-10-01T00:00:00Z',
          },
          {
            actionDate: '2026-10-01',
            text: '<p><strong>Clinic Access Act</strong></p><p>This bill expands clinic hours &amp; access.</p>',
            updateDate: '2026-10-05T00:00:00Z',
          },
        ],
      });
    const detail = DETAIL[url.pathname];
    return detail ? Response.json(detail) : new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { fn, seen };
}

describe('helpers', () => {
  it('formats numbers and public URLs like Congress.gov', () => {
    expect(ordinal(119)).toBe('119th');
    expect(ordinal(121)).toBe('121st');
    expect(ordinal(112)).toBe('112th');
    expect(displayNumber('HR', '1')).toBe('H.R. 1');
    expect(displayNumber('SJRES', '5')).toBe('S.J.Res. 5');
    expect(publicUrl(119, 'HR', '1')).toBe(
      'https://www.congress.gov/bill/119th-congress/house-bill/1',
    );
    expect(normalizeArea('Economics and Public Finance')).toBe(
      normalizeArea('Economics & Public Finance'),
    );
  });

  it('maps latest-action text to a status', () => {
    expect(statusFromAction('Became Public Law No: 119-21.')).toBe('signed');
    expect(statusFromAction('Vetoed by President.')).toBe('vetoed');
    expect(statusFromAction('Presented to President.')).toBe('passed');
    expect(statusFromAction('Passed Senate without amendment by Unanimous Consent.')).toBe(
      'passed_chamber',
    );
    expect(statusFromAction('Referred to the House Committee on Ways and Means.')).toBe(
      'in_committee',
    );
    expect(statusFromAction('Introduced in House')).toBe('introduced');
  });

  it('refuses to run without a key and never leaks it in errors', async () => {
    expect(() => new CongressClient('')).toThrow(/API key/);
    const bad = new CongressClient('wrong-key', fakeApi().fn);
    await expect(bad.listUpdated(new Date(), new Date(), 0)).rejects.toThrow(/HTTP 403/);
    await expect(bad.listUpdated(new Date(), new Date(), 0)).rejects.not.toThrow(/wrong-key/);
  });
});

describe('syncCongressBills', () => {
  it('ingests bills with provenance, sponsors, categories and status, idempotently', async () => {
    const api = fakeApi();
    const client = new CongressClient('test-key', api.fn);
    const now = new Date('2026-11-10T12:00:00Z');
    const r1 = await syncCongressBills(pool, client, {
      now,
      since: new Date('2026-11-01T00:00:00Z'),
    });
    expect(r1).toMatchObject({ bills: 2, leaders: 2 });
    expect(api.seen[0]).toContain('fromDateTime=2026-11-01T00%3A00%3A00Z');

    const { rows } = await pool.query(
      `SELECT b.number, b.status, b.source, b.external_id, b.source_url, c.name AS category,
              l.name AS sponsor, l.office_kind, l.party, p.slug AS sponsor_place
         FROM bills b LEFT JOIN communities c ON c.id = b.category_id
         JOIN bill_sponsors s ON s.bill_id = b.id JOIN leaders l ON l.id = s.leader_id
         LEFT JOIN places p ON p.id = l.place_id
        ORDER BY b.number`,
    );
    expect(rows).toEqual([
      expect.objectContaining({
        number: 'H.R. 1 (119th)',
        status: 'signed',
        source: 'congress.gov',
        external_id: 'us:119:hr:1',
        source_url: 'https://www.congress.gov/bill/119th-congress/house-bill/1',
        category: 'Economics & Public Finance',
        sponsor: 'Jane Doe',
        office_kind: 'us_house',
        party: 'Republican',
        sponsor_place: 'texas',
      }),
      expect.objectContaining({
        number: 'S. 42 (119th)',
        status: 'in_committee',
        category: 'Health',
        sponsor: 'Sam Roe',
        office_kind: 'us_senate',
        sponsor_place: 'new-york',
      }),
    ]);

    // Running again creates no duplicates and resumes from the cursor.
    const r2 = await syncCongressBills(pool, client, { now: new Date('2026-11-10T13:00:00Z') });
    expect(r2.leaders).toBe(0);
    const { rows: n } = await pool.query<{ bills: number; leaders: number }>(
      "SELECT (SELECT count(*)::int FROM bills WHERE source = 'congress.gov') AS bills, (SELECT count(*)::int FROM leaders WHERE source = 'congress.gov') AS leaders",
    );
    expect(n[0]).toEqual({ bills: 2, leaders: 2 });

    // Timeline and the latest CRS summary, as plain text.
    const { rows: tl } = await pool.query(
      "SELECT a.seq, a.text FROM bill_actions a JOIN bills b ON b.id = a.bill_id WHERE b.external_id = 'us:119:s:42' ORDER BY a.seq",
    );
    expect(tl.map((r) => r.text)).toEqual([
      'Referred to the Committee on Finance.',
      'Introduced in Senate',
    ]);
    const { rows: sum } = await pool.query(
      "SELECT summary FROM bills WHERE external_id = 'us:119:s:42'",
    );
    expect(sum[0].summary).toBe('Clinic Access Act\nThis bill expands clinic hours & access.');
    const second = api.seen.filter((u) => u.includes('/v3/bill?'))[1];
    expect(second).toContain('fromDateTime=2026-11-10T12%3A00%3A00Z');

    const { rows: state } = await pool.query(
      "SELECT last_error, items_last_run, synced_through FROM sync_state WHERE source = 'congress.gov'",
    );
    expect(state[0]).toMatchObject({ last_error: null, items_last_run: 2 });
    const { rows: dirty } = await pool.query<{ dirty: boolean }>('SELECT dirty FROM data_version');
    expect(dirty[0]!.dirty).toBe(true);
  });

  it('records the error and keeps the cursor when the source fails', async () => {
    const before = await pool.query(
      "SELECT synced_through FROM sync_state WHERE source = 'congress.gov'",
    );
    const broken = new CongressClient('wrong-key', fakeApi().fn);
    await expect(syncCongressBills(pool, broken)).rejects.toThrow(/HTTP 403/);
    const after = await pool.query(
      "SELECT synced_through, last_error FROM sync_state WHERE source = 'congress.gov'",
    );
    expect(after.rows[0].synced_through).toEqual(before.rows[0].synced_through);
    expect(after.rows[0].last_error).toMatch(/HTTP 403/);
  });
});
