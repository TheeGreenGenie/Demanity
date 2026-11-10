import type { Pool } from '@demanity/db';
import { BudgetExhausted, isTransient, ProviderRateLimited, type ApiBudget } from './budget.js';

/**
 * Presidential executive orders from the Federal Register API (R23).
 *
 * Facts used here come from a live request on 2026-11-10 (the documentation
 * site blocks automated readers): GET
 * https://www.federalregister.gov/api/v1/documents.json with
 * conditions[type][]=PRESDOCU, conditions[presidential_document_type][]=executive_order,
 * order=newest, per_page, fields[] → { count, results: [{ document_number,
 * executive_order_number, title, signing_date, publication_date, html_url,
 * abstract, president: { name } }] }. No API key is needed and no rate limit
 * is published, so we make one request per run (see budget.ts).
 */

export const SOURCE = 'federalregister';
const URL_BASE = 'https://www.federalregister.gov/api/v1/documents.json';

export interface FRDocument {
  document_number: string;
  executive_order_number?: string | number | null;
  title: string;
  signing_date?: string | null;
  publication_date: string;
  html_url: string;
  abstract?: string | null;
  president?: { name?: string } | null;
}

export class FederalRegisterClient {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly budget: ApiBudget | null = null,
  ) {}

  async latestExecutiveOrders(perPage = 20) {
    const url = new URL(URL_BASE);
    url.searchParams.append('conditions[type][]', 'PRESDOCU');
    url.searchParams.append('conditions[presidential_document_type][]', 'executive_order');
    url.searchParams.set('order', 'newest');
    url.searchParams.set('per_page', String(perPage));
    for (const f of [
      'document_number',
      'executive_order_number',
      'title',
      'signing_date',
      'publication_date',
      'html_url',
      'abstract',
      'president',
    ])
      url.searchParams.append('fields[]', f);
    await this.budget?.take();
    const res = await this.fetchFn(url.toString(), {
      headers: { 'User-Agent': 'Demanity civic data sync (open source)' },
    });
    if (isTransient(res.status)) throw new ProviderRateLimited(SOURCE, res.status);
    if (!res.ok) throw new Error(`Federal Register request failed: HTTP ${res.status}`);
    return (await res.json()) as { count?: number; results: FRDocument[] };
  }
}

export async function syncExecutiveOrders(
  pool: Pool,
  client: FederalRegisterClient,
  opts: { perRun?: number } = {},
): Promise<{ orders: number; stoppedEarly: string | null }> {
  await pool.query(
    `INSERT INTO sync_state (source, last_run_at) VALUES ($1, now())
     ON CONFLICT (source) DO UPDATE SET last_run_at = now()`,
    [SOURCE],
  );
  try {
    const res = await client.latestExecutiveOrders(opts.perRun ?? 20);
    let orders = 0;
    for (const d of res.results) {
      await pool.query(
        `INSERT INTO executive_orders (document_number, eo_number, title, signing_date, publication_date,
                                       president, abstract, url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (document_number) DO UPDATE
           SET title = EXCLUDED.title, abstract = EXCLUDED.abstract, fetched_at = now()`,
        [
          d.document_number,
          d.executive_order_number == null ? null : String(d.executive_order_number),
          d.title,
          d.signing_date ?? null,
          d.publication_date,
          d.president?.name ?? '',
          d.abstract ?? '',
          d.html_url,
        ],
      );
      orders++;
    }
    await pool.query(
      `UPDATE sync_state SET last_success_at = now(), last_error = NULL, items_last_run = $2,
              synced_through = now() WHERE source = $1`,
      [SOURCE, orders],
    );
    return { orders, stoppedEarly: null };
  } catch (err) {
    if (err instanceof BudgetExhausted || err instanceof ProviderRateLimited)
      return { orders: 0, stoppedEarly: err.message };
    await pool.query('UPDATE sync_state SET last_error = $2 WHERE source = $1', [
      SOURCE,
      (err as Error).message.slice(0, 500),
    ]);
    throw err;
  }
}
