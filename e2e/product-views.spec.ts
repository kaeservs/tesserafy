/**
 * The views added since P9, as a member would open them: Scorecards, Meetings
 * with its filters and CSV, Reports with coaching, a seller's own page, and
 * Notifications. Each page must render what it promises and offer a member
 * only what a member may do.
 *
 * The e2e account is a member, not an owner. It reads production and writes
 * nothing; opening Notifications marks the account's own as read, which is
 * what opening it is for.
 */
import { expect, test, type Page } from '@playwright/test';

const USERNAME = process.env['E2E_USERNAME'] ?? 'kaeser';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'tesserafy2026';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(USERNAME);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

test('Scorecards lists the templates and shows what each criterion means, without an editor for a member', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Scorecards' }).click();
  await page.waitForURL((url) => url.pathname === '/scorecards');
  await expect(page.getByRole('heading', { name: 'Tesserafy templates' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New scorecard' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Discovery', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/scorecards/discovery');
  await expect(page.getByRole('heading', { name: 'Criteria' })).toBeVisible();
  await expect(page.locator('main ol li').first()).toContainText('% of the score');
  await page.goto('/scorecards/new');
  // Inside main: Next's route announcer is an alert too.
  await expect(page.locator('main').getByRole('alert')).toHaveText('Only an owner of your company can write a scorecard.');
});

test('Meetings filters by score and outcome, and its CSV link keeps the filters', async ({ page }) => {
  await signIn(page);
  await page.goto('/conversations');
  const form = page.getByRole('search', { name: 'Find a meeting' });
  await expect(form).toBeVisible();
  await form.getByLabel('Score', { exact: true }).selectOption('high');
  await form.getByLabel('Outcome').selectOption('none');
  await form.getByRole('button', { name: 'Show' }).click();
  await page.waitForURL((url) => url.searchParams.get('score') === 'high' && url.searchParams.get('outcome') === 'none');
  await expect(page.getByText(/of \d+ meetings? match\./)).toBeVisible();
  const csv = page.getByRole('link', { name: 'Download CSV' });
  await expect(csv).toHaveAttribute('href', /\/api\/export\/meetings\?.*score=high/);

  const response = await page.request.get((await csv.getAttribute('href'))!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/csv');
  expect((await response.text()).split('\r\n')[0]).toContain('date,title,customer,scorecard');
});

test('Reports shows what goes with a win, and a member cannot open another seller’s page', async ({ page }) => {
  await signIn(page);
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'What goes with a win' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download as CSV' }).first()).toHaveAttribute('href', /table=weeks/);

  // A member opens only their own; anyone else's — here, nobody's — is not found.
  const other = await page.goto('/reports/sellers/00000000-0000-4000-8000-000000000000');
  expect(other?.status()).toBe(404);
});

test('Notifications opens from the header and says what it is for', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: /^Notifications/ }).click();
  await page.waitForURL((url) => url.pathname === '/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('There is no email yet, so this is where they arrive.', { exact: false })).toBeVisible();
  // Opening it reads them: the header no longer counts any as new.
  await page.reload();
  await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible();
});
