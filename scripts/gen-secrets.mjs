#!/usr/bin/env node
// Prints freshly generated development secrets in .env format.
// Usage: node scripts/gen-secrets.mjs >> .env
// Never commit the output, and never reuse these values in production.

import { randomBytes } from 'node:crypto';

const b64 = () => randomBytes(32).toString('base64');

console.log(`RATE_LIMIT_SECRET=${b64()}`);
console.log(`VAULT_SERVICE_TOKEN=${randomBytes(32).toString('hex')}`);
console.log(`VAULT_TOKEN_KEYS=1:${b64()}`);
console.log(`VAULT_LOOKUP_KEY=${b64()}`);
console.log(`VAULT_LOCAL_KEK=${b64()}`);
