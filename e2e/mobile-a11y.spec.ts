/**
 * Every page a member uses, on a phone: nothing pushes the page sideways (a
 * wide table scrolls inside itself), and axe finds no WCAG 2.1 A or AA
 * violation. Found and fixed together once; this keeps it that way.
 *
 * As the member account, reading only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const USERNAME = process.env['E2E_USERNAME'] ?? 'kaeser';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'tesserafy2026';

test.use({ viewport: { width: 375, height: 800 } });

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(USERNAME);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

test('the member pages fit a phone and pass an accessibility scan', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto('/conversations');
  const call = await page.locator('main a[href^="/conversations/"]:not([href$="/new"])').first().getAttribute('href');

  const pages = ['/dashboard', '/conversations', call ?? '/conversations', '/insights', '/reports', '/reports?weeks=52', '/examples', '/scorecards', '/settings', '/feedback', '/prep', '/coaching', '/guidance'];
  const problems: string[] = [];
  for (const path of pages) {
    await page.goto(path);
    await page.waitForLoadState('load');
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (sideways > 1) problems.push(`${path}: the page scrolls sideways by ${sideways}px`);
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const violation of scan.violations) {
      problems.push(`${path}: ${violation.id} on ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(', ')}`);
    }
  }
  expect(problems).toEqual([]);
});
