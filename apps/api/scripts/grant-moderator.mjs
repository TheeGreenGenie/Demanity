#!/usr/bin/env node
// Operator tool: grant or revoke the moderator role. There is deliberately no
// API for this, so a compromised account can never promote itself.
// Every change is written to the public moderation log.
//
// Usage (from apps/api):
//   pnpm moderator:grant <username>
//   pnpm moderator:revoke <username>
// Needs ACTIVITY_DATABASE_URL in the repo-root .env.

import pg from 'pg';

const [action, username] = process.argv.slice(2);
if (!['grant', 'revoke'].includes(action) || !/^[a-z0-9_]{3,30}$/.test(username ?? '')) {
  console.error('Usage: grant-moderator.mjs <grant|revoke> <username>');
  process.exit(2);
}
if (!process.env.ACTIVITY_DATABASE_URL) {
  console.error('ACTIVITY_DATABASE_URL is required');
  process.exit(2);
}

const client = new pg.Client({ connectionString: process.env.ACTIVITY_DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  const { rows } = await client.query('SELECT id, status FROM accounts WHERE username = $1', [
    username,
  ]);
  const account = rows[0];
  if (!account) throw new Error(`No account named ${username}`);
  if (action === 'grant' && account.status !== 'active') {
    throw new Error(
      `Only active (verified, 2FA-confirmed) accounts can moderate; ${username} is ${account.status}`,
    );
  }

  const result =
    action === 'grant'
      ? await client.query(
          "INSERT INTO account_roles (account_id, role) VALUES ($1, 'moderator') ON CONFLICT DO NOTHING",
          [account.id],
        )
      : await client.query(
          "DELETE FROM account_roles WHERE account_id = $1 AND role = 'moderator'",
          [account.id],
        );

  if (result.rowCount) {
    await client.query(
      `INSERT INTO moderation_log (action, target_username, reason_code, actor_role)
       VALUES ($1, $2, 'operator_role_change', 'operator')`,
      [action === 'grant' ? 'role.moderator.granted' : 'role.moderator.revoked', username],
    );
  }
  await client.query('COMMIT');
  const past = action === 'grant' ? 'granted' : 'revoked';
  console.log(result.rowCount ? `${past} moderator role for ${username}` : 'No change needed');
} catch (err) {
  await client.query('ROLLBACK');
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
