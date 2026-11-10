// DEVELOPMENT ONLY: pnpm --filter @demanity/api dev:panel -- <label>
// Lets the seeded dev moderators (dev_mod_*) cast their blind votes on any
// fact-check panel they sit on, through the running local API, so you can
// watch a review reach a decision without three real moderators.
// <label> is one of: verified, context_added, misleading, removed.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '@demanity/db';
import { createSession, deleteSession } from '../src/auth/sessions.js';

const LABELS = ['verified', 'context_added', 'misleading', 'removed'];
const label = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
if (!LABELS.includes(label)) {
  console.error(`Usage: pnpm --filter @demanity/api dev:panel -- <${LABELS.join('|')}>`);
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '..', '..', '..', '.env');
if (!existsSync(envFile)) {
  console.error('No .env at the repo root.');
  process.exit(2);
}
process.loadEnvFile(envFile);
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing: NODE_ENV=production.');
  process.exit(2);
}
const dbHost = new URL(process.env.ACTIVITY_DATABASE_URL ?? 'postgres://missing').hostname;
if (dbHost !== '127.0.0.1' && dbHost !== 'localhost') {
  console.error(`Refusing: the activity database is ${dbHost}, not local.`);
  process.exit(2);
}
const api = `http://127.0.0.1:${process.env.API_PORT ?? 3000}`;

const pool = createPool(process.env.ACTIVITY_DATABASE_URL!);
try {
  // Only seed accounts, never real people.
  const { rows: mods } = await pool.query<{ id: string; username: string }>(
    `SELECT a.id, a.username FROM accounts a JOIN dev_seed_accounts s ON s.account_id = a.id
       JOIN account_roles r ON r.account_id = a.id AND r.role = 'moderator' ORDER BY a.username`,
  );
  if (mods.length === 0)
    console.log('No dev moderators. Run: pnpm --filter @demanity/api seed:dev-moderators');
  let cast = 0;
  for (const m of mods) {
    const token = await createSession(pool, m.id, 'full');
    try {
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const queue = await fetch(`${api}/v1/moderation/fact-checks`, { headers });
      if (!queue.ok) throw new Error(`API answered ${queue.status}. Is the demo running?`);
      const { assigned } = (await queue.json()) as {
        assigned: Array<{ id: string; myVote: string | null }>;
      };
      for (const seat of assigned.filter((s) => !s.myVote)) {
        const res = await fetch(`${api}/v1/moderation/fact-checks/${seat.id}/vote`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ vote: label }),
        });
        const body = (await res.json()) as { status?: string; outcome?: string };
        console.log(`${m.username}: ${res.status} ${body.status ?? ''} ${body.outcome ?? ''}`);
        cast++;
      }
    } finally {
      await deleteSession(pool, token);
    }
  }
  console.log(cast ? `Cast ${cast} vote(s).` : 'No open seats for dev moderators.');
} finally {
  await pool.end();
}
