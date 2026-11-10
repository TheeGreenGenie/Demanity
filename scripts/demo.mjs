#!/usr/bin/env node
// Runs the whole app locally for manual testing: identity vault (3100), API
// (3000) and the exported web app (8081). Ctrl+C stops everything.
// Usually started via `pnpm demo`, which builds and exports first.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
if (!existsSync(envFile)) {
  console.error(
    'Missing .env at the repo root (copy .env.example, then run node scripts/gen-secrets.mjs).',
  );
  process.exit(2);
}

const inUse = (port) =>
  new Promise((resolve) => {
    const s = createConnection({ host: '127.0.0.1', port });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });
for (const port of [3000, 3100, 8081]) {
  if (await inUse(port)) {
    console.error(`Port ${port} is already in use. Stop the other server first.`);
    process.exit(2);
  }
}

const procs = [];
const run = (name, cmd, args, cwd, opts = {}) => {
  const p = spawn(cmd, args, { cwd: join(root, cwd), stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const tag = `[${name}]`;
  p.stdout.on('data', (d) => process.stdout.write(d.toString().replace(/^/gm, `${tag} `)));
  p.stderr.on('data', (d) => process.stderr.write(d.toString().replace(/^/gm, `${tag} `)));
  p.on('exit', (code) => code && console.error(`${tag} exited with code ${code}`));
  procs.push(p);
};

const env = { ...process.env, LOG_LEVEL: 'warn', NODE_ENV: 'development' };
run('vault', process.execPath, [`--env-file=${envFile}`, 'dist/server.js'], 'apps/vault', { env });
run('api', process.execPath, [`--env-file=${envFile}`, 'dist/server.js'], 'apps/api', { env });
run('web', 'pnpm', ['exec', 'expo', 'serve', 'dist', '--port', '8081'], 'apps/mobile', {
  shell: process.platform === 'win32',
  env: { ...process.env, CI: '1' },
});

console.log('\nDemanity is starting:  http://localhost:8081');
console.log('Email codes appear below, tagged [vault] (no real email is sent in development).');
console.log('Press Ctrl+C to stop.\n');

const stop = () => {
  for (const p of procs) {
    if (process.platform === 'win32' && p.pid)
      spawn('taskkill', ['/pid', String(p.pid), '/T', '/F']);
    else p.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
