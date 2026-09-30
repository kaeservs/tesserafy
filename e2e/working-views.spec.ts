/**
 * The views added for working with calls, as a member opens them: Reports'
 * period and goals, a call's Who talked and its moment links and examples,
 * Examples, Themes over time, and Feedback remembering where it came from.
 *
 * The e2e account is a member, not an owner. It reads production and writes
 * nothing: no example is saved, no speaker marked, no feedback sent — the
 * writes behind these pages are checked by `pnpm qa` on a probe it erases.
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

test('Reports changes period, carries it into its CSV, and shows goals without letting a member set one', async ({ page }) => {
  await signIn(page);
  await page.goto('/reports');
  await page.getByLabel('Period').selectOption('26');
  await page.getByRole('button', { name: 'Show' }).click();
  await page.waitForURL((url) => url.searchParams.get('weeks') === '26');
  await expect(page.locator('main > p.muted').first()).toContainText('Last 6 months');

  const csv = page.locator('section:has(#trend-heading)').getByRole('link', { name: 'Download as CSV' });
  await expect(csv).toHaveAttribute('href', /weeks=26/);
  const response = await page.request.get((await csv.getAttribute('href'))!);
  expect(response.status()).toBe(200);
  expect((await response.text()).split('\r\n').filter(Boolean)).toHaveLength(27);

  const trends = page.locator('section:has(#criteria-trend-heading)');
  await expect(trends.getByRole('columnheader', { name: 'Goal' })).toBeVisible();
  await expect(trends.locator('input[name=target]')).toHaveCount(0);
  // The seller table exists once the member has added a call; until then it says so, for the period chosen.
  const sellers = page.locator('section:has(#sellers-heading)');
  if ((await sellers.locator('table').count()) > 0) {
    await expect(sellers.getByRole('columnheader', { name: 'Talked' })).toBeVisible();
  } else {
    await expect(sellers).toContainText('in the last 6 months');
  }
});

test('a call says who talked, and every line can be linked to and saved as an example', async ({ page }) => {
  await signIn(page);
  await page.goto('/conversations');
  const first = page.locator('main a[href^="/conversations/"]:not([href$="/new"])').first();
  await first.click();
  await page.waitForURL((url) => /^\/conversations\/[0-9a-f-]{36}$/.test(url.pathname));

  const talk = page.locator('section:has(#talk-heading)');
  await expect(talk.getByRole('heading', { name: 'Who talked' })).toBeVisible();
  await expect(talk.locator('tbody tr').first()).toContainText('%');

  const lines = page.locator('li.segment');
  const count = await lines.count();
  expect(count).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Copy a link to this moment' })).toHaveCount(count);
  await expect(page.getByRole('button', { name: 'Save as an example' })).toHaveCount(count);

  // A moment's timestamp is the link itself: following it lands on that line.
  const second = lines.nth(Math.min(1, count - 1));
  await second.locator('a.moment-time').click();
  await expect(page).toHaveURL(new RegExp(`#${(await second.getAttribute('id'))!}$`));
  expect(await page.evaluate(() => document.querySelector(':target')?.classList.contains('segment') ?? false)).toBe(true);
});

test('the dashboard opens on what needs you', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard');
  const agenda = page.locator('section:has(#agenda-heading)');
  await expect(agenda.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  // Either a list of links to act on, or a sentence saying there is nothing.
  expect((await agenda.locator('ul.agenda a').count()) > 0 || (await agenda.getByText(/^Nothing today/).count()) > 0).toBe(true);
});

test('Prepare opens with a form that asks for the profile, not for LinkedIn access', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Prepare' }).click();
  await page.waitForURL((url) => url.pathname === '/prep');
  await expect(page.getByLabel('Who is the call with?')).toBeVisible();
  await expect(page.getByLabel('Their LinkedIn profile (optional)')).toBeVisible();
  await expect(page.getByLabel('What their profile says (optional)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare' })).toBeDisabled();
});

test('Coaching opens for a member, with what is assigned to them', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Coaching' }).click();
  await page.waitForURL((url) => url.pathname === '/coaching');
  await expect(page.getByRole('heading', { name: 'For you' })).toBeVisible();
  // A member sees only their own; the team's is an owner's.
  await expect(page.getByRole('heading', { name: 'Assigned across the team' })).toHaveCount(0);
});

test('AI guidance shows a member what the AI was taught, without letting them change it', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'AI guidance' }).click();
  await page.waitForURL((url) => url.pathname === '/guidance');
  await expect(page.getByRole('heading', { name: 'Call types' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Learned from corrections/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save instruction' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Switch off' })).toHaveCount(0);
});

test('Examples and Themes over time open for a member', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Examples' }).click();
  await page.waitForURL((url) => url.pathname === '/examples');
  await expect(page.getByRole('heading', { name: 'Examples', level: 1 })).toBeVisible();

  await page.goto('/insights');
  const insights = await page.locator('main ul.signals > li').count();
  if (insights > 0) {
    await expect(page.getByRole('heading', { name: 'Themes over time' })).toBeVisible();
  }
});

test('Feedback remembers the page it was opened from, and waits for something to be written', async ({ page }) => {
  await signIn(page);
  await page.goto('/reports');
  await page.getByRole('link', { name: 'Feedback' }).click();
  await page.waitForURL((url) => url.pathname === '/feedback' && url.searchParams.get('from') === '/reports');
  await expect(page.getByText('Sent from /reports')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to the Tesserafy team' })).toBeDisabled();
});
