import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from '@demanity/db';

export type SessionScope = 'onboarding' | 'recovery' | 'full';

export const SESSION_TTL_SECONDS: Record<SessionScope, number> = {
  onboarding: 24 * 60 * 60,
  recovery: 15 * 60,
  full: 30 * 24 * 60 * 60,
};

export interface Session {
  accountId: string;
  scope: SessionScope;
  status: 'pending' | 'verified' | 'active' | 'banned';
  username: string;
}

const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest();

export async function createSession(
  pool: Pool,
  accountId: string,
  scope: SessionScope,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO sessions (token_hash, account_id, scope, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [hash(token), accountId, scope, SESSION_TTL_SECONDS[scope]],
  );
  return token;
}

export async function findSession(pool: Pool, token: string): Promise<Session | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await pool.query<{
    account_id: string;
    scope: SessionScope;
    status: Session['status'];
    username: string;
  }>(
    `SELECT s.account_id, s.scope, a.status, a.username
       FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hash(token)],
  );
  const r = rows[0];
  if (!r || r.status === 'banned') return null;
  return { accountId: r.account_id, scope: r.scope, status: r.status, username: r.username };
}

export async function deleteSession(pool: Pool, token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hash(token)]);
}
