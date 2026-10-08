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

test('the menu goes to each part of the page', async ({ page }) => {
  await page.goto('/');
  const links = page.getByRole('navigation', { name: 'On this page' }).getByRole('link');
  await expect(links.first()).toBeAttached();
  for (const href of await links.evaluateAll((all) => all.map((link) => link.getAttribute('href')))) {
    expect(href).toMatch(/^#[a-z-]+$/);
    await expect(page.locator(`section${href}`)).toHaveCount(1);
  }
});

test('the overlay demo answers from the sample call, quoting it, and changes its look', async ({ page }) => {
  await page.goto('/');
  const overlay = page.getByRole('group', { name: /Tesserafy overlay/ });
  // Two lines in, the customer has named the pain; the recap quotes her words.
  await page.getByRole('button', { name: 'Next line' }).click();
  await page.getByRole('button', { name: 'Next line' }).click();
  await overlay.getByRole('button', { name: 'Recap' }).click();
  await expect(overlay.getByText('“takes us two full days every month”', { exact: true })).toBeVisible();
  // Our own price is never something the call said.
  await overlay.getByRole('textbox', { name: 'Ask about the call' }).fill('What is our price?');
  await overlay.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(overlay.getByText(/not in this call/)).toBeVisible();
  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('.od-card')).toHaveAttribute('data-theme', 'dark');
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
