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
  await page.goto('/communities');
  await shot('02-explore');
  await page.goto('/humanity');
  await shot('03-humanity');
  await page.goto('/c/health');
  await shot('04-community');

  await addVirtualPasskeyDevice(page);
  await page.goto('/join');
  await shot('05-join');
  await signUp(page, stack, 'designer');
  await shot('06-account');

  await page.goto('/c/health');
  await page.getByRole('button', { name: 'Follow' }).filter({ visible: true }).click();
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
});
