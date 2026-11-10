import { randomBytes } from 'node:crypto';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { startStack, type Stack } from './stack.js';

let stack: Stack;

test.beforeAll(async () => {
  stack = await startStack();
});

test.afterAll(async () => {
  await stack?.stop();
});

/** A virtual platform authenticator (Chrome DevTools Protocol WebAuthn domain). */
async function addVirtualPasskeyDevice(page: Page): Promise<{ cdp: CDPSession; id: string }> {
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

test('a new person signs up, verifies, confirms email, creates a passkey and signs back in', async ({
  page,
}) => {
  const suffix = randomBytes(3).toString('hex');
  const username = `e2e_${suffix}`;
  const email = `${username}@example.com`;

  await page.goto('/');
  const device = await addVirtualPasskeyDevice(page);

  // Guest home → join
  await expect(page.getByText('Democracy + Humanity')).toBeVisible();
  await page.getByRole('button', { name: 'Join Demanity' }).click();

  // Username
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Identity (development fake verifier approves this format)
  await expect(page.getByText('Verify your identity')).toBeVisible();
  await page.getByLabel('First name').fill('Edie');
  await page.getByLabel('Last name').fill('Tester');
  await page.getByLabel('Date of birth').fill('1991-04-12');
  await page.getByLabel('License state').fill('NY');
  await page.getByLabel('Driver’s license number').fill(`E2E${suffix.toUpperCase()}99`);
  await page.getByRole('button', { name: 'Verify' }).click();

  // Email 2FA with the vault-generated code
  await expect(page.getByText('Confirm your email')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('6-digit code')).toBeVisible();
  await expect.poll(() => stack.latestCode(email)).toMatch(/^\d{6}$/);
  await page.getByLabel('6-digit code').fill(stack.latestCode(email)!);
  await page.getByRole('button', { name: 'Confirm' }).click();

  // Passkey creation (virtual authenticator), then automatic sign-in with it
  await expect(page.getByText('Create your passkey')).toBeVisible();
  await page.getByRole('button', { name: 'Create passkey' }).click();
  await expect(page.getByText('Verified Demanity member')).toBeVisible();
  // Earlier screens stay mounted (hidden) in the stack, so match only visible text.
  await expect(page.getByText(username, { exact: true }).filter({ visible: true })).toBeVisible();

  const { credentials } = await device.cdp.send('WebAuthn.getCredentials', {
    authenticatorId: device.id,
  });
  expect(credentials).toHaveLength(1);
  expect(credentials[0]!.isResidentCredential).toBe(true);

  // Sign out, then sign back in with only the passkey
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Join Demanity' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  await expect(page.getByText('Verified Demanity member')).toBeVisible();
});

test('a second account for the same person is refused in the UI', async ({ page }) => {
  const license = `DUP${randomBytes(3).toString('hex').toUpperCase()}`;
  for (const [i, expectText] of [
    [1, 'Confirm your email'],
    [2, 'already has a Demanity account'],
  ] as const) {
    await page.goto('/');
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/join');
    await page.getByLabel('Username').fill(`e2e_dup_${i}_${randomBytes(2).toString('hex')}`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('First name').fill('Dee');
    await page.getByLabel('Last name').fill('Uplicate');
    await page.getByLabel('Date of birth').fill('1988-02-02');
    await page.getByLabel('License state').fill('TX');
    await page.getByLabel('Driver’s license number').fill(license);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText(expectText)).toBeVisible();
  }
});
