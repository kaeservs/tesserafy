/**
 * The sign-up page and the login page agree about whether sign-up is open.
 *
 * The switch is the operator's, in the database, so this cannot assume which
 * way it is set: it checks that the two pages a visitor sees say the same
 * thing. A sign-up form with no way to reach it, or a link to a page that
 * says "opens soon", is the failure a person would notice first.
 *
 * It reads production and writes nothing.
 */
import { expect, test } from '@playwright/test';

test('the sign-up page and the login page tell the same story', async ({ page }) => {
  await page.goto('/signup');
  const open = (await page.getByRole('button', { name: 'Create account' }).count()) > 0;
  if (!open) await expect(page.getByText('Sign-up opens soon.')).toBeVisible();

  await page.goto('/login');
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(open ? 1 : 0);
  await expect(page.getByText('Access is by invitation.', { exact: false })).toHaveCount(open ? 0 : 1);
});
