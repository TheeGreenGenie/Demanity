import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addVirtualPasskeyDevice, signUp } from './flows.js';
import { startStack, type Stack } from './stack.js';

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

test('members follow, post, see the post in their feed with a reason, and comment; guests can read', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await addVirtualPasskeyDevice(page);
  await signUp(page, stack, 'e2e_social');

  // Join a community from its page
  await page.goto('/c/health');
  await expect(visible(page, 'Health').first()).toBeVisible();
  await button(page, 'Join').click();
  await expect(button(page, 'Joined')).toBeVisible();

  // Write a post in it
  const title = `Free clinic opens downtown ${randomBytes(2).toString('hex')}`;
  await button(page, 'Write a post').click();
  await page.getByLabel('Title').fill(title);
  await page
    .getByLabel("What's on your mind?")
    .fill('Open weekdays 9 to 5, no appointment needed.');
  await page.getByRole('radio', { name: 'Health' }).click();
  await button(page, 'Post').click();
  await expect(visible(page, title)).toBeVisible();

  // Comment on it
  await page.getByLabel('Add a comment').fill('Great news for the neighborhood.');
  await button(page, 'Post comment').click();
  await expect(visible(page, 'Great news for the neighborhood.')).toBeVisible();

  // The feed shows it, labelled with why
  await page.goto('/');
  await expect(visible(page, 'Your feed')).toBeVisible();
  await expect(visible(page, title)).toBeVisible();
  await expect(visible(page, 'You follow Health').first()).toBeVisible();

  // A guest (fresh browser context) can read the post but is asked to join to react
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto('/c/health');
  await expect(visible(guestPage, title)).toBeVisible();
  await button(guestPage, /^Like/).first().click();
  await expect(guestPage.getByLabel('Username')).toBeVisible(); // redirected to join
  await guest.close();
});

test('Humanity offers kudos but no dislikes', async ({ page }) => {
  await page.goto('/');
  await addVirtualPasskeyDevice(page);
  await signUp(page, stack, 'e2e_kind');

  const title = `Neighbors rebuilt the playground ${randomBytes(2).toString('hex')}`;
  await page.goto('/compose?community=humanity');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel("What's on your mind?").fill('Forty volunteers, one weekend.');
  await button(page, 'Post').click();
  await expect(visible(page, title)).toBeVisible();

  await expect(button(page, /^Kudos/)).toBeVisible();
  await expect(button(page, /^Dislike/)).toHaveCount(0);
  await expect(button(page, /^Like/)).toHaveCount(0);

  await button(page, /^Kudos/).click();
  await expect(button(page, 'Kudos (1)')).toBeVisible();
});
