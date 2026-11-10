import { randomBytes } from 'node:crypto';
import { expect, type CDPSession, type Page } from '@playwright/test';
import type { Stack } from './stack.js';

/** A virtual platform authenticator (Chrome DevTools Protocol WebAuthn domain). */
export async function addVirtualPasskeyDevice(
  page: Page,
): Promise<{ cdp: CDPSession; id: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, id: authenticatorId };
}

/**
 * Full browser sign-up: username → identity → email code → passkey, ending
 * signed in on the account screen. Returns the username.
 */
export async function signUp(page: Page, stack: Stack, prefix = 'e2e'): Promise<string> {
  const suffix = randomBytes(3).toString('hex');
  const username = `${prefix}_${suffix}`;
  const email = `${username}@example.com`;

  await page.goto('/join');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Verify your identity')).toBeVisible();
  await page.getByLabel('First name').fill('Edie');
  await page.getByLabel('Last name').fill('Tester');
  await page.getByLabel('Date of birth').fill('04/12/1991'); // US format, as people type it
  await page.getByLabel('License state').fill('NY');
  await page.getByLabel('Driver’s license number').fill(`E2E${suffix.toUpperCase()}99`);
  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(page.getByText('Confirm your email')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('6-digit code')).toBeVisible();
  await expect
    .poll(() => stack.latestCode(email), {
      message: `no code in vault output:\n${stack.vaultLog().slice(-2000)}`,
    })
    .toMatch(/^\d{6}$/);
  await page.getByLabel('6-digit code').fill(stack.latestCode(email)!);
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect(page.getByText('Create your passkey')).toBeVisible();
  await page.getByRole('button', { name: 'Create passkey' }).click();
  await expect(page.getByText('Verified Demanity member')).toBeVisible();
  return username;
}
