/**
 * Recording consent is asked for before a call is kept, and said afterwards.
 *
 * The routes refuse without it and `pnpm qa` proves that against the API. What
 * only a browser can witness is the person's side: that the box is there,
 * that it gates the action, and that a call says what is on file for it.
 *
 * It reads production and writes nothing — the upload form is inspected and
 * never submitted, and the microphone is never started.
 */
import { expect, test } from '@playwright/test';

const USERNAME = process.env['E2E_USERNAME'] ?? 'kaeser';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'tesserafy2026';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(USERNAME);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
});

test('an import cannot be submitted without confirming consent', async ({ page }) => {
  await page.goto('/conversations/new');
  const consent = page.getByRole('checkbox', { name: /Everyone on this call was told/ });
  await expect(consent).toBeVisible();
  await expect(consent).not.toBeChecked();
  // The browser's own validation stops the submit; the route refuses anyway.
  await expect(consent).toHaveAttribute('required', '');
});

test('the microphone does not start until consent is confirmed', async ({ page }) => {
  await page.goto('/live/mic');
  const start = page.getByRole('button', { name: 'Start listening' });
  // Browsers without speech recognition show a notice instead; nothing to gate.
  test.skip((await start.count()) === 0, 'no speech recognition in this browser');

  await expect(start).toBeDisabled();
  await page.getByRole('checkbox', { name: /Everyone on this call has been told/ }).check();
  await expect(start).toBeEnabled();
});

test('a call says what consent is on file for it', async ({ page }) => {
  await page.goto('/conversations');
  await page.locator('a[href^="/conversations/"]:not([href="/conversations/new"])').first().click();
  await page.waitForURL(/\/conversations\/[0-9a-f-]{36}$/);
  await expect(
    page.getByText(/^(Recording consent confirmed by|No recording consent on file)/),
  ).toBeVisible();
});
