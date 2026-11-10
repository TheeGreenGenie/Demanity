import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { addVirtualPasskeyDevice, signUp } from '../tests/flows.js';
import { startStack, type Stack } from '../tests/stack.js';

const out = process.env.SCREENSHOT_DIR ?? join(process.cwd(), 'screenshots-out');
mkdirSync(out, { recursive: true });

let stack: Stack;
test.beforeAll(async () => {
  stack = await startStack();
});
test.afterAll(async () => {
  await stack?.stop();
});

test('capture key screens', async ({ page }) => {
  const shot = async (name: string) => {
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${name}.png`), fullPage: false });
  };

  await page.goto('/');
  await shot('01-guest-home');
  await page.goto('/search');
  await shot('02-search');
  await page.goto('/humanity');
  await shot('03-humanity');
  await page.goto('/c/health');
  await shot('04-community');
  await page.goto('/c/california?tab=overview');
  await shot('10-place-overview');
  await page.goto('/c/california?tab=scores');
  await page
    .getByRole('button', { name: /^Health:/ })
    .filter({ visible: true })
    .click();
  await shot('11-place-scores');
  await page.goto('/c/california?tab=living');
  await shot('12-place-cost-of-living');
  await page.goto('/place/austin-tx');
  await shot('13-city');
  await page.goto('/c/california?tab=leaders');
  await page
    .getByRole('link', { name: /Governor of California/ })
    .filter({ visible: true })
    .click();
  await shot('14-leader');
  await page.getByRole('tab', { name: 'Requests' }).filter({ visible: true }).click();
  await shot('15-leader-requests');
  await page.goto('/guide/how-a-bill-becomes-law');
  await shot('16-guide');

  await addVirtualPasskeyDevice(page);
  await page.goto('/join');
  await shot('05-join');
  await signUp(page, stack, 'designer');
  await shot('06-account');

  await page.goto('/c/health');
  await page.getByRole('button', { name: 'Join' }).filter({ visible: true }).click();
  await page.goto('/');
  await shot('07-member-feed');

  const sample = page
    .getByText('[Sample] What would make local clinics easier to use?')
    .filter({ visible: true })
    .first();
  await sample.click();
  await shot('08-post-thread');

  await page.goto('/compose?community=health');
  await shot('09-compose');
  await page.goto('/bills');
  await shot('17-bills-swipe');
  await page.getByRole('button', { name: 'Support' }).filter({ visible: true }).click();
  await shot('18-bills-after-swipe');
});
