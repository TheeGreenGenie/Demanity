#!/usr/bin/env node
// Live check of the Twilio Verify SMS adapter on a Twilio FREE TRIAL account.
// Sends a real code to TWILIO_TEST_TO, then verifies the code you type in.
//
// Free-trial limits (Twilio docs): only verified numbers (up to 5), SMS only to
// your sign-up country, trial expires after 30 days. This script never upgrades
// or spends money; it only uses the trial's free units.
//
// Usage (from apps/vault):  pnpm twilio:trial
// Needs in the repo-root .env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//   TWILIO_VERIFY_SERVICE_SID, TWILIO_TEST_TO (your verified number, e.g. +14155552671)

import { createInterface } from 'node:readline/promises';
import { normalizeUsPhone } from '../dist/crypto/lookup.js';
import { TwilioVerifyProvider } from '../dist/providers/two-factor.js';

const env = process.env;
for (const name of [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_VERIFY_SERVICE_SID',
  'TWILIO_TEST_TO',
]) {
  if (!env[name]) {
    console.error(`Missing ${name} in .env`);
    process.exit(2);
  }
}

const to = normalizeUsPhone(env.TWILIO_TEST_TO);
const twilio = new TwilioVerifyProvider({
  accountSid: env.TWILIO_ACCOUNT_SID,
  authToken: env.TWILIO_AUTH_TOKEN,
  serviceSid: env.TWILIO_VERIFY_SERVICE_SID,
});

console.log(`Sending a verification code by SMS to ${to.slice(0, -4)}****…`);
await twilio.start(to, 'sms');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const wrong = await twilio.check(to, '000000');
console.log(`Wrong-code check correctly rejected: ${wrong === false ? 'yes' : 'NO (unexpected)'}`);
const code = (await rl.question('Enter the code you received: ')).trim();
rl.close();

const ok = await twilio.check(to, code);
console.log(ok ? 'PASS: Twilio Verify approved the code.' : 'FAIL: code was not approved.');
process.exit(ok ? 0 : 1);
