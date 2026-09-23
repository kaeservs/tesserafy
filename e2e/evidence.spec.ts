/**
 * P1, witnessed.
 *
 *   pnpm e2e
 *
 * The gate: "Every displayed signal links to a timestamped quote; clicking
 * scrolls to that segment." Five other gates closed while this one stayed at
 * "built, not witnessed in a browser", because the only thing that can witness
 * it is a browser.
 *
 * The check that matters most is not the scrolling. It is that the quote under
 * a signal appears, character for character, inside the segment it points at.
 * A model that paraphrases produces a quote that reads better than the
 * transcript, every link still works, every highlight still lands, and the
 * product is quietly lying about what a customer said. That is the one failure
 * this product cannot have, and it is invisible to every test that does not
 * compare the two strings.
 *
 * It reads production and writes nothing.
 */
import { expect, test, type Page } from '@playwright/test';

const USERNAME = process.env['E2E_USERNAME'] ?? 'kaeser';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'tesserafy2026';

/** How many conversations to open. Every one of them is a page load. */
const AT_MOST = 6;

/**
 * Whitespace is the only difference allowed.
 *
 * A quote is stored as the detector emitted it and the transcript is rendered
 * across text nodes, so a line break can become a space on the way to the DOM.
 * Nothing else is permitted to differ: no trimmed filler, no tidied grammar,
 * no swapped punctuation.
 */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The quote as displayed, without the curly quotes the page wraps it in. */
function unquote(text: string): string {
  return normalise(text).replace(/^[“"]/, '').replace(/[”"]$/, '');
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(USERNAME);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

test.describe('P1 — every signal links to the words behind it', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('the conversations list is reachable and not empty', async ({ page }) => {
    await page.goto('/conversations');

    const links = page.locator('a[href^="/conversations/"]');
    await expect(links.first()).toBeVisible();
    expect(await links.count()).toBeGreaterThan(0);
  });

  test('every quote under a signal is verbatim, timestamped and lands on its segment', async ({
    page,
  }) => {
    // Six conversations, every signal on each, every quote under every signal,
    // and a click and a scroll for each one. That is minutes of navigation by
    // design — the gate is about breadth, and narrowing it to one page to fit
    // a default timeout would be checking a smaller claim than the one made.
    test.setTimeout(180_000);

    await page.goto('/conversations');
    const hrefs = (
      await page.locator('a[href^="/conversations/"]').evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href') ?? ''),
      )
    )
      .filter((href) => /^\/conversations\/[0-9a-f-]{36}$/.test(href))
      .slice(0, AT_MOST);

    expect(hrefs.length, 'no conversations to check').toBeGreaterThan(0);

    let quotesChecked = 0;
    let conversationsWithSignals = 0;

    for (const href of hrefs) {
      await page.goto(href);

      // Only the Signals section. The scorecard cites evidence too, and it is
      // the same chain, but the gate is worded about signals and a test that
      // quietly widens its own scope is a test nobody can read.
      const signals = page.locator('section:has(h2#signals-heading) ul.signals > li.signal');
      const signalCount = await signals.count();
      if (signalCount === 0) continue;
      conversationsWithSignals += 1;

      for (let index = 0; index < signalCount; index += 1) {
        const quotes = signals.nth(index).locator('ul.evidence a[href^="#segment-"]');
        const quoteCount = await quotes.count();

        // The gate says *every* displayed signal links to a quote. A signal
        // rendered with no evidence under it is the invariant breaking, not a
        // case to skip.
        expect(quoteCount, `a signal in ${href} shows no evidence`).toBeGreaterThan(0);

        for (let q = 0; q < quoteCount; q += 1) {
          const quote = quotes.nth(q);
          const raw = normalise((await quote.innerText()) ?? '');

          // "at 01:01" — the timestamp the gate asks for, on the quote itself.
          expect(raw, `a quote in ${href} carries no timestamp`).toMatch(/\bat \d{2}:\d{2}\b/);

          const said = unquote(raw.replace(/\s*at \d{2}:\d{2}\s*$/, ''));
          expect(said.length, `an empty quote in ${href}`).toBeGreaterThan(0);

          const target = (await quote.getAttribute('href')) ?? '';
          // By attribute, not by `#id`: a uuid starting with a digit is not a
          // valid CSS id selector and would silently match nothing.
          const segment = page.locator(`li[id="${target.slice(1)}"]`);
          await expect(segment, `${target} is not on the page`).toHaveCount(1);

          // The claim, checked against the words themselves.
          const transcript = normalise(await segment.innerText());
          expect(
            transcript,
            `a quote in ${href} is not in the segment it points at:\n  quote: ${said}\n  segment: ${transcript}`,
          ).toContain(said);

          // And clicking it actually takes you there.
          await quote.click();
          await expect(segment).toBeInViewport({ timeout: 5000 });

          // The phrase is marked inside the segment, not merely nearby.
          const marks = segment.locator('mark');
          expect(await marks.count(), `${target} highlights nothing`).toBeGreaterThan(0);

          quotesChecked += 1;
        }
      }
    }

    expect(conversationsWithSignals, 'no conversation showed a signal').toBeGreaterThan(0);
    expect(quotesChecked, 'no quote was checked').toBeGreaterThan(0);
    console.log(
      `P1: ${quotesChecked} quote(s) across ${conversationsWithSignals} conversation(s) checked verbatim.`,
    );
  });

  test('a conversation with no signals says so rather than inventing one', async ({ page }) => {
    // The checklist's step 5, and the cheaper half of the same honesty: some
    // transcripts contain nothing worth surfacing, and an empty list is the
    // correct answer. A product that always finds something is broken in a way
    // that looks like it is working.
    await page.goto('/conversations');
    const hrefs = (
      await page.locator('a[href^="/conversations/"]').evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href') ?? ''),
      )
    ).filter((href) => /^\/conversations\/[0-9a-f-]{36}$/.test(href));

    let emptyFound = false;
    for (const href of hrefs.slice(0, AT_MOST)) {
      await page.goto(href);
      const section = page.locator('section:has(h2#signals-heading)');
      if ((await section.locator('ul.signals > li.signal').count()) === 0) {
        await expect(section).toContainText(/no signals|nothing/i);
        emptyFound = true;
        break;
      }
    }

    test.skip(!emptyFound, 'every conversation checked had signals; nothing to assert here');
  });
});
