import pg from 'pg';

export type Pool = pg.Pool;

export function createPool(connectionString: string): Pool {
  if (!connectionString) {
    throw new Error('Database connection string is required');
  }
  return new pg.Pool({ connectionString, max: 10 });
}
