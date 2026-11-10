import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { addVirtualPasskeyDevice, signUp } from './flows.js';
import { startStack, type Stack } from './stack.js';

/**
 * The citation loop end to end: a moderator approves a contributor, the
 * contributor cites a leader, the moderator accepts it, and a member rates it.
 * Roles are granted the way operators do it (the grant script; there is no
 * API to make someone a moderator).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:3000';

let stack: Stack;
test.beforeAll(async () => {
  stack = await startStack();
});
test.afterAll(async () => {
  await stack?.stop();
});

const button = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name }).filter({ visible: true });
const tab = (page: Page, name: string) => page.getByRole('tab', { name }).filter({ visible: true });

function grantModerator(username: string) {
  execFileSync(
    process.execPath,
    [
      `--env-file=${join(root, '.env')}`,
      join(root, 'apps/api/scripts/grant-moderator.mjs'),
      'grant',
      username,
    ],
    { stdio: 'pipe' },
  );
}

/** Calls the API as the signed-in user of `page` (token from the web session store). */
async function apiAs(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ({ api, method, path, body }) => {
      // Runs in the browser (this package has no DOM types, hence the narrow cast).
      const store = (
        globalThis as unknown as { sessionStorage: { getItem(k: string): string | null } }
      ).sessionStorage;
      const token = store.getItem('demanity.session');
      const init: RequestInit = {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      const res = await fetch(`${api}${path}`, init);
      return res.status;
    },
    { api: API, method, path, body },
  );
}

/** The innermost element that contains `text` and a `button` (i.e. that item's card). */
function cardWith(page: Page, text: string, buttonName: string) {
  return page
    .locator('div')
    .filter({ hasText: text })
    .filter({ has: page.getByRole('button', { name: buttonName }) })
    .last();
}

async function openGovernorHealth(page: Page) {
  await page.goto('/c/texas?tab=leaders');
  await page
    .getByRole('link', { name: /Governor of Texas/ })
    .filter({ visible: true })
    .click();
  await tab(page, 'Scores').click();
  await button(page, /^See all 32 categories/).click();
  await button(page, /^Health:/).click();
}

test('contributor cites a leader, a moderator accepts it, and a member rates it', async ({
  browser,
}) => {
  // Moderator
  const modCtx = await browser.newContext();
  const mod = await modCtx.newPage();
  await mod.goto('/');
  await addVirtualPasskeyDevice(mod);
  const modName = await signUp(mod, stack, 'e2e_mod');
  grantModerator(modName);

  // Contributor
  const contribCtx = await browser.newContext();
  const contrib = await contribCtx.newPage();
  await contrib.goto('/');
  await addVirtualPasskeyDevice(contrib);
  const contribName = await signUp(contrib, stack, 'e2e_contrib');
  expect(
    await apiAs(mod, 'PUT', '/v1/moderation/contributors', {
      username: contribName,
      category: 'health',
      reasonCode: 'essay_approved',
    }),
  ).toBe(204);

  // The contributor submits a citation from the leader's score breakdown.
  const claim = `Signed the rural clinic funding bill ${randomBytes(2).toString('hex')}`;
  await openGovernorHealth(contrib);
  await contrib.getByText('+ Add a citation (contributors)').filter({ visible: true }).click();
  await contrib.getByLabel('What did they do?').fill(claim);
  await contrib
    .getByLabel('Source link')
    .fill('https://www.congress.gov/bill/119th-congress/house-bill/1');
  await contrib.getByLabel('When did it happen?').fill('06/01/2026');
  await button(contrib, 'Submit for review').click();
  await expect(contrib.getByText('Sent for review')).toBeVisible();

  // The moderator accepts it from the review queue.
  await mod.goto('/account');
  await button(mod, /^Moderator review \(\d+ waiting\)/).click();
  const card = mod.getByText(claim).filter({ visible: true });
  await expect(card).toBeVisible();
  // Accept the card that holds our claim (other runs may have left items).
  const accept = cardWith(mod, claim, 'Accept').getByRole('button', { name: 'Accept' });
  await accept.click();
  await expect(card).toHaveCount(0);

  // A member sees it under the leader's score and rates it once.
  await openGovernorHealth(contrib);
  await expect(contrib.getByText(claim).filter({ visible: true })).toBeVisible();
  const ourCard = cardWith(contrib, claim, 'Accurate? Yes');
  await ourCard.getByRole('button', { name: 'Accurate? Yes' }).click();
  await expect(ourCard.getByText('Yes 1 · No 0')).toBeVisible();

  await modCtx.close();
  await contribCtx.close();
});

test('a member applies to contribute and a moderator approves the anonymous essay', async ({
  browser,
}) => {
  const modCtx = await browser.newContext();
  const mod = await modCtx.newPage();
  await mod.goto('/');
  await addVirtualPasskeyDevice(mod);
  grantModerator(await signUp(mod, stack, 'e2e_mod2'));

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await addVirtualPasskeyDevice(page);
  await signUp(page, stack, 'e2e_applicant');

  const marker = `Essay ${randomBytes(3).toString('hex')}.`;
  await page.goto('/account');
  await button(page, 'Become a contributor').click();
  await page.getByRole('button', { name: 'Education' }).filter({ visible: true }).click();
  await button(page, 'Submit application').click();
  await expect(page.getByText(/Write at least 300 characters/)).toBeVisible();
  await page
    .getByLabel('Your essay')
    .fill(`${marker} ${'School funding, attendance and reading scores, with sources. '.repeat(6)}`);
  await button(page, 'Submit application').click();
  await expect(page.getByText('Education: Under review')).toBeVisible();

  await mod.goto('/moderation');
  const card = mod.locator('div').filter({ hasText: marker });
  await expect(card.first()).toBeVisible();
  await cardWith(mod, marker, 'Approve').getByRole('button', { name: 'Approve' }).click();
  await expect(mod.getByText(marker)).toHaveCount(0);

  await page.goto('/contribute');
  await expect(page.getByText(/Contributor in Education until/)).toBeVisible();

  await modCtx.close();
  await ctx.close();
});
