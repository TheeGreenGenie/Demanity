import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';

/**
 * Starts the real stack for end-to-end tests: the identity vault, the API, and
 * the exported web app (expo serve). Requires the repo-root .env, the Docker
 * databases, and built outputs (`pnpm build` and `expo export --platform web`).
 *
 * Email codes come from the vault's development email sender, which prints
 * them to the vault's stdout; the stack captures that output for the tests.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface Stack {
  latestCode(email: string): string | undefined;
  /** Captured vault output (stdout + stderr), for diagnosing failures. */
  vaultLog(): string;
  stop(): Promise<void>;
}

async function waitFor(url: string, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

/** True if something already accepts connections on 127.0.0.1:port. */
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

export async function startStack(): Promise<Stack> {
  // Another Demanity stack on these ports would silently answer our readiness
  // checks while our own servers fail to bind, so refuse to start instead.
  for (const port of [3000, 3100, 8081]) {
    if (await portInUse(port)) {
      throw new Error(
        `Port ${port} is already in use. Stop any running Demanity servers (or other apps on that port) before running e2e.`,
      );
    }
  }

  const envFile = join(root, '.env');
  if (!existsSync(envFile)) throw new Error('Missing repo-root .env (see .env.example)');
  for (const f of ['apps/vault/dist/server.js', 'apps/api/dist/server.js', 'apps/mobile/dist']) {
    if (!existsSync(join(root, f)))
      throw new Error(`Missing ${f}: build first (see e2e/README.md)`);
  }

  // Each run starts with fresh rate-limit counters, otherwise repeated local runs
  // hit the real production limits (5 sign-ups per hour per network). Local only.
  process.loadEnvFile(envFile);
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const redisHost = new URL(redisUrl).hostname;
  if (redisHost !== '127.0.0.1' && redisHost !== 'localhost') {
    throw new Error(`Refusing to clear rate limits on non-local Redis (${redisHost})`);
  }
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const keys = await redis.keys('demanity-rl:*');
  if (keys.length) await redis.del(...keys);
  redis.disconnect();

  const procs: ChildProcess[] = [];
  let vaultOut = '';
  const node = (cwd: string) =>
    spawn(process.execPath, [`--env-file=${envFile}`, 'dist/server.js'], {
      cwd: join(root, cwd),
      env: { ...process.env, LOG_LEVEL: 'warn', NODE_ENV: 'development' },
    });

  const vault = node('apps/vault');
  vault.stdout!.on('data', (d) => (vaultOut += d.toString()));
  vault.stderr!.on('data', (d) => (vaultOut += `[stderr] ${d.toString()}`));
  procs.push(vault);
  procs.push(node('apps/api'));
  procs.push(
    spawn('pnpm', ['exec', 'expo', 'serve', 'dist', '--port', '8081'], {
      cwd: join(root, 'apps/mobile'),
      shell: process.platform === 'win32',
      env: { ...process.env, CI: '1' },
    }),
  );

  await waitFor('http://127.0.0.1:3100/health');
  await waitFor('http://127.0.0.1:3000/health');
  await waitFor('http://localhost:8081/');

  return {
    vaultLog: () => vaultOut,
    latestCode(email: string) {
      const re = new RegExp(
        `\\[dev email\\] to=${email.replace(/[.+]/g, '\\$&')}[^\\n]*\\n[^\\n]*?(\\d{6})`,
        'g',
      );
      let code: string | undefined;
      for (const m of vaultOut.matchAll(re)) code = m[1];
      return code;
    },
    async stop() {
      for (const p of procs) {
        if (process.platform === 'win32' && p.pid) {
          spawn('taskkill', ['/pid', String(p.pid), '/T', '/F']);
        } else {
          p.kill('SIGTERM');
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    },
  };
}
