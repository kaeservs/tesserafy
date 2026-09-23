import { defineConfig, devices } from '@playwright/test';

/**
 * The browser the P1 gate asks for.
 *
 * P1 is the one gate in the build plan that no unit test can close: "every
 * displayed signal links to a timestamped quote; clicking scrolls to that
 * segment". Every word of that is about a rendered page — a link that resolves,
 * a scroll that happens, a highlight that lands on the right phrase — and it
 * has sat at "built, not witnessed" while five other gates passed.
 *
 * It runs against a real deployment holding real data, not a fixture. The
 * claim being tested is that the evidence chain survives the whole path from
 * detector output to the words under a person's cursor, and a seeded fixture
 * would test the renderer while assuming the part that actually breaks.
 *
 * Set E2E_BASE_URL to point at a deployment; without it, a local dev server is
 * started and reused.
 */
const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // The suite signs in once and then only reads, so the specs do not contend.
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],

  use: {
    baseURL,
    // Kept only for a failure. A passing run of a read-only suite has nothing
    // worth storing, and a trace of a signed-in session holds meeting content.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  ...(process.env['E2E_BASE_URL']
    ? {}
    : {
        webServer: {
          command: 'pnpm --filter @tesserafy/web dev',
          url: 'http://localhost:3000',
          reuseExistingServer: true,
          timeout: 180_000,
        },
      }),
});
