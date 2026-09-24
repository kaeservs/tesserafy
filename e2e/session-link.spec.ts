/**
 * A session that lands at the wrong door.
 *
 * Supabase does not refuse a `redirect_to` it has not been told to allow — it
 * silently substitutes the project's site URL. Measured against this project:
 * asking for `…/auth/confirm` came back with a link pointing at the bare
 * origin. The origin is `/`, which redirects to a page that requires the
 * session those tokens would have created, so the person lands on the login
 * form holding credentials nothing ever read.
 *
 * The real fix is an allow-list entry in the project's settings. This test
 * covers the part that survives somebody forgetting it.
 *
 * The tokens here are deliberately nonsense. What is being tested is that the
 * fragment reaches the page that knows what to do with it, not that Supabase
 * accepts it — and a test that needed a live session would need a service-role
 * key in CI, which is a worse trade than the coverage is worth.
 */
import { expect, test } from '@playwright/test';

test.describe('a session link that lands anywhere', () => {
  test('is carried from the root to the page that can read it', async ({ page }) => {
    await page.goto('/#access_token=not-a-real-token&refresh_token=also-not-real');

    // Landing on /login with an error is the correct end of this journey: the
    // fragment was read, found to be rubbish, and said so. Waiting for the end
    // of the journey rather than the middle of it, because the server
    // redirect to /login happens first and carries the fragment with it; the
    // catcher then forwards it. Asserting on the first URL that says /login
    // catches the product halfway through its own redirect chain.
    await page.waitForURL((url) => url.pathname === '/login' && url.search.includes('error='), {
      timeout: 20_000,
    });
  });

  test('is carried from a page that would otherwise bounce to sign-in', async ({ page }) => {
    // The downgrade sends a link to the site URL, which may be any path
    // somebody has configured. Whichever it is, the fragment must not be lost.
    await page.goto('/conversations#access_token=not-a-real-token&refresh_token=also-not-real');

    await page.waitForURL((url) => url.pathname === '/login' && url.search.includes('error='), {
      timeout: 20_000,
    });
  });

  test('leaves an ordinary page alone', async ({ page }) => {
    // The cost of the catcher is one effect on every page load. It must do
    // nothing at all when there is nothing to catch.
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    expect(new URL(page.url()).pathname).toBe('/login');
    expect(page.url()).not.toContain('error=');
  });
});
