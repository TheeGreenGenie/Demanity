import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addVirtualPasskeyDevice, signUp } from './flows.js';
import { startStack, type Stack } from './stack.js';

let stack: Stack;

test.beforeAll(async () => {
  stack = await startStack();
});

test.afterAll(async () => {
  await stack?.stop();
});

test('a new person signs up, verifies, confirms email, creates a passkey and signs back in', async ({
  page,
}) => {
  await page.goto('/');
  const device = await addVirtualPasskeyDevice(page);

  // Guest home → join
  await expect(page.getByText('Democracy + Humanity')).toBeVisible();
  const username = await signUp(page, stack);

  // Earlier screens stay mounted (hidden) in the stack, so match only visible text.
  await expect(page.getByText(username, { exact: true }).filter({ visible: true })).toBeVisible();
  const { credentials } = await device.cdp.send('WebAuthn.getCredentials', {
    authenticatorId: device.id,
  });
  expect(credentials).toHaveLength(1);
  expect(credentials[0]!.isResidentCredential).toBe(true);

  // Sign out, then sign back in with only the passkey
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page.getByRole('button', { name: 'Join Demanity' }).filter({ visible: true }),
  ).toBeVisible();
  await page.goto('/sign-in');
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

test('the identity form explains every problem instead of silently blocking', async ({ page }) => {
  await page.goto('/join');
  await page.getByLabel('Username').fill(`e2e_form_${randomBytes(2).toString('hex')}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Verify your identity')).toBeVisible();

  // Submit with mistakes: the button works and each field says what to fix.
  await page.getByLabel('Date of birth').fill('13/45/1990');
  await page.getByLabel('License state').fill('ZZ');
  await page.getByLabel('Driver’s license number').fill('12');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Please fix the highlighted fields.')).toBeVisible();
  await expect(page.getByText('Use the format MM/DD/YYYY, for example 07/04/1990.')).toBeVisible();
  await expect(
    page.getByText('Use the two-letter state code from your license, for example CA.'),
  ).toBeVisible();
  await expect(
    page.getByText('Enter the full license number (at least 4 characters).'),
  ).toBeVisible();
  await expect(
    page.getByText('Enter your first name as it appears on your license.'),
  ).toBeVisible();

  // Fixing the fields clears the messages and lets verification proceed.
  await page.getByLabel('First name').fill('Fix');
  await page.getByLabel('Last name').fill('Itt');
  await page.getByLabel('Date of birth').fill('07/04/1990');
  await page.getByLabel('License state').fill('PA');
  await page
    .getByLabel('Driver’s license number')
    .fill(`FIX${randomBytes(3).toString('hex').toUpperCase()}`);
  await expect(page.getByText('Please fix the highlighted fields.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Confirm your email')).toBeVisible();
});
