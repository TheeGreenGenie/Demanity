import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';

/**
 * Response cache for public, viewer-independent pages (place, leader and
 * score pages, guides). See docs/adr/0007-precomputed-civic-data.md.
 *
 * - The JSON body is built once per data version and reused for every client.
 * - `data_version` (bumped by the rollup job) is checked at most every
 *   `versionCheckMs`, so a cached hit costs no database query at all.
 * - Responses carry an ETag and `Cache-Control: public`, so browsers and a CDN
 *   can reuse them too; a matching If-None-Match gets an empty 304.
 * - Bounded size, least-recently-used eviction.
 *
 * Only routes whose output is identical for every viewer may use this.
 */
export class ResponseCache {
  private readonly entries = new Map<string, { version: number; body: string; etag: string }>();
  private version = 0;
  private checkedAt = -Infinity;

  constructor(
    private readonly pool: Pool,
    private readonly opts: {
      maxEntries?: number;
      versionCheckMs?: number;
      maxAgeSeconds?: number;
    } = {},
  ) {}

  private async currentVersion(): Promise<number> {
    const now = Date.now();
    if (now - this.checkedAt >= (this.opts.versionCheckMs ?? 10_000)) {
      const { rows } = await this.pool.query<{ version: string }>(
        'SELECT version FROM data_version',
      );
      this.version = Number(rows[0]?.version ?? 0);
      this.checkedAt = now;
    }
    return this.version;
  }

  /** Forget the known version (e.g. right after a recompute in this process). */
  invalidate(): void {
    this.checkedAt = -Infinity;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Sends the cached body for `key`, building it with `load` on a miss.
   * `load` returning null means "not found" (never cached).
   */
  async serve(
    req: FastifyRequest,
    reply: FastifyReply,
    key: string,
    load: () => Promise<unknown>,
  ): Promise<FastifyReply> {
    const version = await this.currentVersion();
    let entry = this.entries.get(key);
    if (entry && entry.version === version) {
      this.entries.delete(key); // refresh LRU position
      this.entries.set(key, entry);
    } else {
      const data = await load();
      if (data === null) return reply.code(404).send({ error: 'not_found' });
      const body = JSON.stringify(data);
      const etag = `"v${version}-${createHash('sha256').update(body).digest('base64url').slice(0, 16)}"`;
      entry = { version, body, etag };
      this.entries.set(key, entry);
      const max = this.opts.maxEntries ?? 2000;
      while (this.entries.size > max) this.entries.delete(this.entries.keys().next().value!);
    }
    reply.header(
      'cache-control',
      `public, max-age=${this.opts.maxAgeSeconds ?? 60}, stale-while-revalidate=600`,
    );
    reply.header('etag', entry.etag);
    if (req.headers['if-none-match'] === entry.etag) return reply.code(304).send();
    return reply.type('application/json; charset=utf-8').send(entry.body);
  }
}
