import { randomBytes } from 'node:crypto';
import pg from 'pg';

/**
 * Creates a throwaway database on the local test server and returns its URL
 * plus a cleanup function. Requires the docker-compose activity-db (or any
 * Postgres where the user may CREATE DATABASE), set via TEST_DATABASE_URL.
 */
export const ADMIN_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://demanity:dev-only-activity@127.0.0.1:5434/demanity_activity';

export async function createTempDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;

  return {
    url: url.toString(),
    drop: async () => {
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}
