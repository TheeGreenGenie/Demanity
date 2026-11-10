import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';
import { requireSession } from '../auth/guard.js';
import { LABELS, type FactCheckProvider, type Label } from '../factcheck/ai.js';
import { ApiBudget, BudgetExhausted } from '../ingest/budget.js';
import { isModerator, logAction } from '../moderation/service.js';
import type { RouteLimits } from '../rate-limit.js';

/**
 * Fact-check pipeline (R25; docs/MODERATION.md §4).
 *
 * 1. Trigger: enough members flag a comment, or its author asks for a check.
 * 2. Optional AI first pass drafts an assessment for the panel only.
 * 3. Three moderators (mixed leanings when the pool allows; never the author)
 *    vote blind. The majority label applies; if all three differ, the median
 *    label by severity applies, so no single panelist decides.
 * 4. Any decided check can be re-examined once by a panel sharing no member
 *    with any earlier panel on that comment. Every decision is publicly logged.
 */

const member = requireSession({ scopes: ['full'], statuses: ['active'] });
const uuid = { type: 'string', format: 'uuid' } as const;
const idParam = { type: 'object', properties: { id: uuid } } as const;

/** AI calls are budgeted like every other outbound API (ADR 0008). */
export const ANTHROPIC_BUDGET = { perMinute: 5, perHour: 20, perDay: 100, minIntervalMs: 2000 };

const SEVERITY: Record<Label, number> = {
  verified: 0,
  context_added: 1,
  misleading: 2,
  removed: 3,
};

/** Majority of three, or the median by severity when all three differ. */
export function panelOutcome(votes: Label[]): { outcome: Label; votesFor: number } {
  const counts = new Map<Label, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (top && top[1] >= 2) return { outcome: top[0], votesFor: top[1] };
  const median = [...votes].sort((a, b) => SEVERITY[a] - SEVERITY[b])[1]!;
  return { outcome: median, votesFor: 1 };
}

export const OUTCOME_TEXT: Record<Label, string> = {
  verified: 'Fact-checked: verified',
  context_added: 'Fact-checked: context added',
  misleading: 'Fact-checked: misleading',
  removed: 'Removed as clear misinformation',
};

export async function factCheckRoutes(
  app: FastifyInstance,
  deps: {
    pool: Pool;
    limits: RouteLimits;
    provider?: FactCheckProvider | null;
    flagThreshold?: number;
  },
) {
  const { pool, limits } = deps;
  const provider = deps.provider ?? null;
  const flagThreshold = deps.flagThreshold ?? Number(process.env.FACT_CHECK_FLAG_THRESHOLD ?? 5);
  const budget = new ApiBudget(pool, 'anthropic', ANTHROPIC_BUDGET);
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });
  const moderatorOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await isModerator(pool, req.session!.accountId)))
      return reply.code(403).send({ error: 'moderator_only' });
  };

  /** Runs the AI first pass in the background; failures leave the panel to work without it. */
  async function runAi(checkId: string) {
    if (!provider) return;
    try {
      const { rows } = await pool.query<{ body: string; title: string }>(
        `SELECT c.body, p.title FROM fact_checks f
           JOIN comments c ON c.id = f.comment_id JOIN posts p ON p.id = c.post_id
          WHERE f.id = $1`,
        [checkId],
      );
      if (!rows[0]) return;
      const { rows: domains } = await pool.query<{ domain: string }>(
        'SELECT domain FROM approved_sources ORDER BY domain',
      );
      await budget.take();
      const draft = await provider.assess({
        comment: rows[0].body,
        postTitle: rows[0].title,
        approvedDomains: domains.map((d) => d.domain),
      });
      await pool.query(
        "UPDATE fact_checks SET ai_status = 'done', ai_draft = $2, ai_model = $3 WHERE id = $1",
        [checkId, JSON.stringify(draft), provider.model],
      );
    } catch (err) {
      await pool
        .query("UPDATE fact_checks SET ai_status = 'failed' WHERE id = $1", [checkId])
        .catch(() => {});
      app.log.warn(
        { err: { name: (err as Error).name, budget: err instanceof BudgetExhausted } },
        'fact-check AI draft skipped',
      );
    }
  }

  /** Opens a review and, when configured, starts the AI draft. */
  async function open(commentId: string, trigger: string, reviewsId: string | null = null) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO fact_checks (comment_id, trigger, reviews_id, ai_status)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id`,
      [commentId, trigger, reviewsId, provider ? 'pending' : 'disabled'],
    );
    const id = rows[0]?.id;
    if (id) {
      void runAi(id);
      await assignPanels();
    }
    return id ?? null;
  }

  /**
   * Seats three panelists on every review still waiting for a panel. Picks one
   * moderator per declared lean first (in random order), then fills at random.
   * Excludes the comment's author and anyone on an earlier panel for it.
   */
  async function assignPanels() {
    const { rows: waiting } = await pool.query<{ id: string; comment_id: string; author: string }>(
      `SELECT f.id, f.comment_id, c.author_id AS author FROM fact_checks f
         JOIN comments c ON c.id = f.comment_id WHERE f.status = 'awaiting_panel'`,
    );
    for (const w of waiting) {
      const { rows: pool_ } = await pool.query<{ id: string; lean: string | null }>(
        `SELECT r.account_id AS id, l.lean FROM account_roles r
           JOIN accounts a ON a.id = r.account_id AND a.status = 'active'
           LEFT JOIN moderator_leans l ON l.account_id = r.account_id
          WHERE r.role = 'moderator' AND r.account_id IS DISTINCT FROM $2::uuid
            AND NOT EXISTS (SELECT 1 FROM fact_check_panelists p JOIN fact_checks f ON f.id = p.fact_check_id
                             WHERE f.comment_id = $1 AND p.moderator_id = r.account_id)
          ORDER BY random()`,
        [w.comment_id, w.author],
      );
      if (pool_.length < 3) continue;
      const chosen: string[] = [];
      for (const lean of ['left', 'center', 'right'].sort(() => Math.random() - 0.5)) {
        const m = pool_.find((p) => p.lean === lean && !chosen.includes(p.id));
        if (m && chosen.length < 3) chosen.push(m.id);
      }
      for (const p of pool_) if (chosen.length < 3 && !chosen.includes(p.id)) chosen.push(p.id);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rowCount } = await client.query(
          "UPDATE fact_checks SET status = 'in_review' WHERE id = $1 AND status = 'awaiting_panel'",
          [w.id],
        );
        if (rowCount)
          for (const m of chosen)
            await client.query(
              'INSERT INTO fact_check_panelists (fact_check_id, moderator_id) VALUES ($1, $2)',
              [w.id, m],
            );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
  }

  const commentOf = async (id: string) =>
    (
      await pool.query<{ author_id: string | null; status: string }>(
        'SELECT author_id, status FROM comments WHERE id = $1',
        [id],
      )
    ).rows[0];

  const everChecked = async (id: string) =>
    (await pool.query('SELECT 1 FROM fact_checks WHERE comment_id = $1', [id])).rows.length > 0;

  // --- Triggers ------------------------------------------------------------------

  app.post(
    '/v1/comments/:id/fact-check/flag',
    { preHandler: member, config: { rateLimit: limits.stance }, schema: { params: idParam } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const c = await commentOf(id);
      if (!c || c.status !== 'visible') return notFound(reply);
      if (c.author_id === req.session!.accountId)
        return reply.code(403).send({ error: 'use_request_for_own_comment' });
      const { rowCount } = await pool.query(
        'INSERT INTO fact_check_flags (account_id, comment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.session!.accountId, id],
      );
      if (!rowCount) return reply.code(409).send({ error: 'already_flagged' });
      const { rows } = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM fact_check_flags WHERE comment_id = $1',
        [id],
      );
      let opened = false;
      if (rows[0]!.n >= flagThreshold && !(await everChecked(id)))
        opened = (await open(id, 'flags')) !== null;
      return reply.code(201).send({ status: opened ? 'review_opened' : 'flagged' });
    },
  );

  app.post(
    '/v1/comments/:id/fact-check/request',
    { preHandler: member, config: { rateLimit: limits.request }, schema: { params: idParam } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const c = await commentOf(id);
      if (!c || c.status !== 'visible') return notFound(reply);
      if (c.author_id !== req.session!.accountId)
        return reply.code(403).send({ error: 'author_only' });
      if (await everChecked(id)) return reply.code(409).send({ error: 'already_reviewed' });
      await open(id, 'author_request');
      return reply.code(201).send({ status: 'review_opened' });
    },
  );

  // --- Public labels ---------------------------------------------------------------

  /** Current label per comment on a post (latest decided review wins). */
  app.get('/v1/posts/:id/fact-checks', { schema: { params: idParam } }, async (req) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query<{
      id: string;
      comment_id: string;
      outcome: Label;
      votes_for: number;
      decided_at: Date;
      trigger: string;
      open: boolean;
    }>(
      `SELECT DISTINCT ON (f.comment_id) f.id, f.comment_id, f.outcome, f.votes_for, f.decided_at, f.trigger,
              EXISTS (SELECT 1 FROM fact_checks o WHERE o.comment_id = f.comment_id AND o.status <> 'decided') AS open
         FROM fact_checks f JOIN comments c ON c.id = f.comment_id
        WHERE c.post_id = $1 AND f.status = 'decided'
        ORDER BY f.comment_id, f.decided_at DESC`,
      [id],
    );
    const { rows: pending } = await pool.query<{ comment_id: string }>(
      `SELECT f.comment_id FROM fact_checks f JOIN comments c ON c.id = f.comment_id
        WHERE c.post_id = $1 AND f.status <> 'decided'`,
      [id],
    );
    const labels: Record<string, unknown> = {};
    for (const p of pending) labels[p.comment_id] = { status: 'in_review' };
    for (const r of rows)
      labels[r.comment_id] = {
        id: r.id,
        status: r.open ? 'in_review' : 'decided',
        outcome: r.outcome,
        label: OUTCOME_TEXT[r.outcome],
        panel: `${r.votes_for} of 3 moderators`,
        reversed: r.trigger === 'reversal',
        decidedAt: r.decided_at,
      };
    return {
      labels,
      note: 'Fact-checks are decided by three moderators voting blind. Any AI draft is only a starting point for them.',
    };
  });

  // --- Moderators ------------------------------------------------------------------

  app.put(
    '/v1/moderation/lean',
    {
      preHandler: [member, moderatorOnly],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['lean'],
          properties: { lean: { type: 'string', enum: ['left', 'center', 'right'] } },
        },
      },
    },
    async (req, reply) => {
      const { lean } = req.body as { lean: string };
      await pool.query(
        `INSERT INTO moderator_leans (account_id, lean) VALUES ($1, $2)
         ON CONFLICT (account_id) DO UPDATE SET lean = EXCLUDED.lean, set_at = now()`,
        [req.session!.accountId, lean],
      );
      return reply.code(204).send();
    },
  );

  /** Public aggregate only (docs/NONPARTISANSHIP.md): never who declared what. */
  app.get('/v1/moderation/leans', async () => {
    const { rows } = await pool.query<{ lean: string; n: number }>(
      `SELECT l.lean, count(*)::int AS n FROM moderator_leans l
         JOIN account_roles r ON r.account_id = l.account_id AND r.role = 'moderator'
        GROUP BY l.lean`,
    );
    const out: Record<string, number> = { left: 0, center: 0, right: 0 };
    for (const r of rows) out[r.lean] = r.n;
    return { leans: out };
  });

  /** My panel seats. Other panelists' votes stay hidden until the review is decided. */
  app.get('/v1/moderation/fact-checks', { preHandler: [member, moderatorOnly] }, async (req) => {
    await assignPanels();
    const me = req.session!.accountId;
    const { rows } = await pool.query(
      `SELECT f.id, f.trigger, f.status, f.ai_status AS "aiStatus", f.ai_draft AS "aiDraft",
                f.ai_model AS "aiModel", f.created_at AS "createdAt",
                c.id AS "commentId", c.body AS "comment", p.id AS "postId", p.title AS "postTitle",
                mine.vote AS "myVote",
                (SELECT count(*)::int FROM fact_check_panelists x WHERE x.fact_check_id = f.id AND x.vote IS NOT NULL) AS "votesIn",
                prev.outcome AS "previousOutcome"
           FROM fact_check_panelists mine
           JOIN fact_checks f ON f.id = mine.fact_check_id
           JOIN comments c ON c.id = f.comment_id JOIN posts p ON p.id = c.post_id
           LEFT JOIN fact_checks prev ON prev.id = f.reviews_id
          WHERE mine.moderator_id = $1 AND f.status = 'in_review'
          ORDER BY f.created_at`,
      [me],
    );
    const { rows: waiting } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM fact_checks WHERE status = 'awaiting_panel'",
    );
    return { assigned: rows, awaitingPanel: waiting[0]!.n, labels: LABELS };
  });

  app.post(
    '/v1/moderation/fact-checks/:id/vote',
    {
      preHandler: [member, moderatorOnly],
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['vote'],
          properties: { vote: { type: 'string', enum: [...LABELS] } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { vote } = req.body as { vote: Label };
      const me = req.session!.accountId;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: f } = await client.query<{ status: string; comment_id: string }>(
          'SELECT status, comment_id FROM fact_checks WHERE id = $1 FOR UPDATE',
          [id],
        );
        if (!f[0] || f[0].status !== 'in_review') {
          await client.query('ROLLBACK');
          return notFound(reply);
        }
        const { rowCount } = await client.query(
          `UPDATE fact_check_panelists SET vote = $3, voted_at = now()
            WHERE fact_check_id = $1 AND moderator_id = $2 AND vote IS NULL`,
          [id, me, vote],
        );
        if (!rowCount) {
          await client.query('ROLLBACK');
          const seated = await pool.query(
            'SELECT 1 FROM fact_check_panelists WHERE fact_check_id = $1 AND moderator_id = $2',
            [id, me],
          );
          return seated.rows.length
            ? reply.code(409).send({ error: 'already_voted' })
            : reply.code(403).send({ error: 'not_on_panel' });
        }
        const { rows: votes } = await client.query<{ vote: Label | null }>(
          'SELECT vote FROM fact_check_panelists WHERE fact_check_id = $1',
          [id],
        );
        if (votes.some((v) => v.vote === null)) {
          await client.query('COMMIT');
          return reply.code(201).send({ status: 'vote_recorded' });
        }
        const { outcome, votesFor } = panelOutcome(votes.map((v) => v.vote!));
        await client.query(
          "UPDATE fact_checks SET status = 'decided', outcome = $2, votes_for = $3, decided_at = now() WHERE id = $1",
          [id, outcome, votesFor],
        );
        const commentId = f[0].comment_id;
        if (outcome === 'removed')
          await client.query(
            "UPDATE comments SET status = 'removed', removed_reason = 'clear_misinformation' WHERE id = $1",
            [commentId],
          );
        else
          // A reversal restores a comment that an earlier panel removed.
          await client.query(
            `UPDATE comments SET status = 'visible', removed_reason = NULL
              WHERE id = $1 AND status = 'removed' AND removed_reason = 'clear_misinformation' AND removed_by IS NULL`,
            [commentId],
          );
        await client.query('COMMIT');
        await logAction(pool, {
          action: `fact_check.decided_${outcome}`,
          reasonCode: 'panel_majority',
          actorAccountId: me,
        });
        return reply.code(201).send({ status: 'decided', outcome });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  /**
   * Asks for a reversal review: the comment's author, or a moderator who sat on
   * no panel for it. One reversal per decision.
   */
  app.post(
    '/v1/fact-checks/:id/reversal',
    { preHandler: member, config: { rateLimit: limits.request }, schema: { params: idParam } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const me = req.session!.accountId;
      const { rows } = await pool.query<{ comment_id: string; author_id: string | null }>(
        `SELECT f.comment_id, c.author_id FROM fact_checks f JOIN comments c ON c.id = f.comment_id
          WHERE f.id = $1 AND f.status = 'decided'`,
        [id],
      );
      const f = rows[0];
      if (!f) return notFound(reply);
      const isAuthor = f.author_id === me;
      if (!isAuthor) {
        if (!(await isModerator(pool, me))) return reply.code(403).send({ error: 'not_allowed' });
        const sat = await pool.query(
          `SELECT 1 FROM fact_check_panelists p JOIN fact_checks x ON x.id = p.fact_check_id
            WHERE x.comment_id = $1 AND p.moderator_id = $2`,
          [f.comment_id, me],
        );
        if (sat.rows.length) return reply.code(403).send({ error: 'sat_on_a_panel' });
      }
      const already = await pool.query('SELECT 1 FROM fact_checks WHERE reviews_id = $1', [id]);
      if (already.rows.length) return reply.code(409).send({ error: 'already_reviewed' });
      const opened = await open(f.comment_id, 'reversal', id);
      if (!opened) return reply.code(409).send({ error: 'review_in_progress' });
      return reply.code(201).send({ status: 'review_opened' });
    },
  );
}
