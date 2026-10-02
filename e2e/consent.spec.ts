/**
 * Recording consent: confirmed per upload for an import, agreed once for live
 * calls (ADR 0020), and said afterwards on every call.
 *
 * The routes refuse without it and `pnpm qa` proves that against the API. What
 * only a browser can witness is the person's side: that the box is there,
 * that it gates the action, and that a call says what is on file for it.
 *
 * It reads production and writes one thing, once: the test account's own
 * recording agreement. The upload form is inspected and never submitted, and
 * the microphone is never started.
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

test('the microphone does not start until the person has agreed, once', async ({ page }) => {
  await page.goto('/live/mic');
  const start = page.getByRole('button', { name: 'Start listening' });
  // Browsers without speech recognition show a notice instead; nothing to gate.
  test.skip((await start.count()) === 0, 'no speech recognition in this browser');

  // The one-time recording agreement (ADR 0020): until it is made, Start is off.
  const agree = page.getByRole('button', { name: 'I agree' });
  if ((await agree.count()) > 0) {
    await expect(start).toBeDisabled();
    await agree.click();
  }
  await expect(start).toBeEnabled();
  // Agreed once: the next visit does not ask again.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start listening' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'I agree' })).toHaveCount(0);
});

test('a call says what consent is on file for it', async ({ page }) => {
  await page.goto('/conversations');
  await page.locator('a[href^="/conversations/"]:not([href="/conversations/new"])').first().click();
  await page.waitForURL(/\/conversations\/[0-9a-f-]{36}$/);
  await expect(
    page.getByText(/^(Recording consent confirmed by|No recording consent on file)/),
  ).toBeVisible();
});
