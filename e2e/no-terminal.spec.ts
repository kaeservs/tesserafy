/**
 * No page a customer sees tells them to run a command.
 *
 * The product was built operator-first, and its pages said so: "Run pnpm score
 * --company <uuid>" on the dashboard, "pnpm process" on the import page —
 * instructions a customer has no terminal to follow, surviving long after the
 * steps they described started happening by themselves. A pilot's first
 * sign-in found them. Operator commands may still sit folded away under "For
 * operators"; a closed <details> is not part of the visible text, so this
 * reads only what a person sees without opening anything.
 *
 * It reads production and writes nothing.
 */
import { expect, test } from '@playwright/test';

const USERNAME = process.env['E2E_USERNAME'] ?? 'kaeser';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'tesserafy2026';

test('the pages a customer reads name no terminal command', async ({ page }) => {
  // Ten full page loads in one test. At the default 30 s it failed on time,
  // not on content, whenever the nightly run's parallel specs slowed the
  // deployment down — and a check that cries wolf gets ignored.
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(USERNAME);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  const paths = ['/dashboard', '/conversations', '/conversations/new', '/insights', '/search', '/settings', '/account', '/live/mic'];
  await page.goto('/conversations');
  const first = await page
    .locator('a[href^="/conversations/"]:not([href="/conversations/new"])')
    .first()
    .getAttribute('href');
  if (first) paths.push(first);

  for (const path of paths) {
    await page.goto(path);
    const visible = await page.locator('main').innerText();
    expect(visible, `${path} tells a customer to run a command`).not.toMatch(/\bpnpm\b/);
  }
});
