/**
 * Retention, as someone who may see it but not change it.
 *
 * The e2e account is a member of its company, not an owner, which is exactly
 * the case worth witnessing: a retention period is deletion on a schedule, so
 * the form must not be offered to someone the database would refuse, while the
 * period itself is a fact about their data they are entitled to read.
 *
 * It reads production and writes nothing.
 */
import { expect, test } from '@playwright/test';

const USERNAME = process.env['E2E_USERNAME'] ?? 'kaeser';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'tesserafy2026';

test('a member sees how long calls are kept, and is not offered the choice', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(USERNAME);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.waitForURL((url) => url.pathname === '/settings');

  const section = page.getByRole('region', { name: 'How long calls are kept' });
  await expect(section.getByText(/^Calls are (kept|deleted)/)).toBeVisible();
  await expect(section.getByText(/Only an owner of .+ can change this\./)).toBeVisible();
  await expect(section.getByRole('button', { name: 'Review' })).toHaveCount(0);
});
