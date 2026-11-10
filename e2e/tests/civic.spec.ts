import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addVirtualPasskeyDevice, signUp } from './flows.js';
import { startStack, type Stack } from './stack.js';

/**
 * Civic pages against the dev database's sample data (run
 * `pnpm --filter @demanity/api seed:dev-moderators` once to create it).
 */

let stack: Stack;
test.beforeAll(async () => {
  stack = await startStack();
});
test.afterAll(async () => {
  await stack?.stop();
});

const visible = (page: Page, text: string | RegExp) =>
  page.getByText(text).filter({ visible: true });
const button = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name }).filter({ visible: true });
const tab = (page: Page, name: string) => page.getByRole('tab', { name }).filter({ visible: true });

test('guests explore a state: overview, scores with explanations, cost of living, leaders', async ({
  page,
}) => {
  await page.goto('/c/texas');
  await tab(page, 'Overview').click();
  await expect(visible(page, 'Most pressing issues')).toBeVisible();
  await expect(visible(page, 'Upcoming elections')).toBeVisible();
  await expect(visible(page, /Sample data for design only/).first()).toBeVisible();

  await tab(page, 'Scores').click();
  await expect(visible(page, 'Conditions by category')).toBeVisible();
  await expect(visible(page, 'Conditions score').first()).toBeVisible();
  await button(page, /^See all 32 categories/).click();
  await button(page, /^Health:/).click();
  await expect(visible(page, /^Why \d+\/100$/)).toBeVisible();
  await expect(visible(page, /Compared only with states/)).toBeVisible();

  await tab(page, 'Cost of living').click();
  await expect(visible(page, 'MONTHLY BASICS, ONE ADULT')).toBeVisible();
  await button(page, /^Monthly basics/).click();
  await expect(visible(page, 'Groceries, one adult')).toBeVisible();
  await expect(visible(page, /median of 5 states/).first()).toBeVisible();

  await tab(page, 'Leaders').click();
  await page
    .getByRole('link', { name: /Governor of Texas/ })
    .filter({ visible: true })
    .click();
  await expect(tab(page, 'Legislation')).toBeVisible();
  await expect(visible(page, 'Recently passed')).toBeVisible();
});

test('search finds places and hides Humanity', async ({ page }) => {
  await page.goto('/search');
  // Wait until the app has loaded (the directory renders), so typing isn't lost.
  await expect(visible(page, 'Top topics')).toBeVisible();
  await page.getByLabel('Search Demanity').fill('austin');
  await expect(
    page.getByRole('link', { name: /Austin city/ }).filter({ visible: true }),
  ).toBeVisible();
  await page.getByLabel('Search Demanity').fill('humanity');
  await expect(visible(page, 'No results. Try another word.')).toBeVisible();
});

test('members swipe on bills privately and request things from leaders', async ({ page }) => {
  await page.goto('/');
  await addVirtualPasskeyDevice(page);
  await signUp(page, stack, 'e2e_civic');

  await page.goto('/bills');
  await button(page, 'Support').click();
  await expect(visible(page, /^You supported/)).toBeVisible();
  await expect(visible(page, /% support$/).first()).toBeVisible();

  // Requests tab on a leader page
  await page.goto('/c/florida');
  await tab(page, 'Leaders').click();
  await page
    .getByRole('link', { name: /Governor of Florida/ })
    .filter({ visible: true })
    .click();
  await tab(page, 'Requests').click();
  const ask = `Publish meeting notes ${randomBytes(2).toString('hex')}`;
  await button(page, 'Add a request').click();
  await page.getByLabel('Your request').fill(ask);
  await button(page, 'Add request').click();
  await expect(visible(page, ask)).toBeVisible();
});
