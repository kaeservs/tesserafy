import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Only an alias. The app's own modules import each other as `@/lib/...`, which
 * tsconfig resolves and Vitest, without this, does not — so a route could not
 * be tested at all, which is how the ticket route reached production untested.
 */
export default defineConfig({
  resolve: {
    alias: { '@': dirname(fileURLToPath(import.meta.url)) },
  },
});
