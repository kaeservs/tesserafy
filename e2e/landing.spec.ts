/**
 * The landing page, signed out: it says what the product is, shows the plans
 * on sale from the catalogue, fits a phone, and passes an accessibility scan.
 * Reads only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('a visitor sees what Tesserafy is, and what it costs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Know what to say next');
  // A public page: it offers the product, not a way in. People who have an account go to /login.
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  // Prices come from the plans table, never from copy on the page.
  const pricing = page.getByRole('region', { name: 'Pricing' });
  await expect(pricing.getByText(/^\$\d+/).first()).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('the landing page fits and passes an accessibility scan', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways).toBeLessThanOrEqual(1);
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(scan.violations.map((violation) => violation.id)).toEqual([]);
  });
});
