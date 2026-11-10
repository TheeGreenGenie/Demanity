#!/usr/bin/env node
// Verifies every commit in a range carries a DCO "Signed-off-by:" trailer
// matching its author (https://developercertificate.org/).
//
// Usage: node scripts/check-dco.mjs <base-ref> [head-ref]
// Exits 1 and lists offending commits if any are missing a sign-off.

import { execFileSync } from 'node:child_process';

const [base, head = 'HEAD'] = process.argv.slice(2);
if (!base) {
  console.error('Usage: node scripts/check-dco.mjs <base-ref> [head-ref]');
  process.exit(2);
}

const SEP = '\x1e';
const log = execFileSync(
  'git',
  ['log', '--no-merges', `--format=%H%x1f%an <%ae>%x1f%B${SEP}`, `${base}..${head}`],
  { encoding: 'utf8' },
);

const failures = [];
for (const entry of log.split(SEP)) {
  const trimmed = entry.trim();
  if (!trimmed) continue;
  const [sha, author, body = ''] = trimmed.split('\x1f');
  const signoffs = [...body.matchAll(/^Signed-off-by: (.+)$/gm)].map((m) => m[1].trim());
  if (!signoffs.includes(author)) {
    failures.push(`${sha.slice(0, 10)}  ${author}  (sign-offs: ${signoffs.join(', ') || 'none'})`);
  }
}

if (failures.length > 0) {
  console.error('Commits missing a matching DCO sign-off (use `git commit -s`):');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('DCO check passed.');
