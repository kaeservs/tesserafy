/**
 * The operator console's front door.
 *
 * This console reads across every tenant and can open a session as anyone, so
 * the only behaviour worth asserting mechanically is the refusal. A test that
 * signed in as an operator and clicked around would need operator credentials
 * in CI, which is a worse trade than the coverage is worth.
 *
 * It runs against a console you point it at:
 *
 *   ADMIN_BASE_URL=http://localhost:3001 pnpm e2e e2e/admin.spec.ts
 *
 * and skips otherwise, because a suite that fails when an optional app is not
 * running teaches people to ignore it.
 */
import { expect, test } from '@playwright/test';

const ADMIN = process.env['ADMIN_BASE_URL'];

test.describe('the console refuses everybody else', () => {
  test.skip(!ADMIN, 'set ADMIN_BASE_URL to run these');

  test('sends an anonymous visitor to the door', async ({ page }) => {
    for (const path of ['/', '/people', '/companies', '/history', '/onboard', '/companies/00000000-0000-4000-8000-000000000000', '/companies/00000000-0000-4000-8000-000000000000/close']) {
      const response = await page.goto(`${ADMIN}${path}`);
      expect(response?.status(), `${path} should not be served`).toBeLessThan(400);
      expect(new URL(page.url()).pathname, `${path} should redirect`).toBe('/login');
    }
  });

  test('refuses a real user who is not an operator, and keeps no session', async ({ page }) => {
    // A genuine account with a correct password — the case that matters. Being
    // a customer is not being an operator, and the check that says so is in
    // the database, not in this app.
    await page.goto(`${ADMIN}/login`);
    await page.getByLabel('Email').fill('kaeser@tesserafy.local');
    await page.getByLabel('Password').fill('tesserafy2026');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('That did not work.')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/login');

    // Not cosmetic: the session was thrown away, so walking to a page directly
    // does not work either.
    await page.goto(`${ADMIN}/`);
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('says nothing about what is behind it', async ({ page }) => {
    await page.goto(`${ADMIN}/login`);

    // No hint of tenants, users, or that a failed sign-in was an authorisation
    // failure rather than a wrong password. Someone who should not be here
    // learns only that their password did not work.
    const text = (await page.locator('body').innerText()).toLowerCase();
    for (const leak of ['platform admin', 'tenant', 'not authorised', 'not authorized']) {
      expect(text, `the login page should not mention "${leak}"`).not.toContain(leak);
    }
  });
});
