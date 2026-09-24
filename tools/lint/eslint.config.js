// @ts-check
import { resolve } from 'node:path';

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * What the linter is for here, and what it is not.
 *
 * `pnpm lint` was `pnpm -r lint` and no package implemented it, so it exited 0
 * and looked like a gate. That is worse than having nothing: a green check
 * that checks nothing is believed.
 *
 * The rules below are chosen against mistakes this codebase has actually made
 * or nearly made, not from a style guide. Every one of them is type-aware,
 * because the ones that are not would mostly be arguing about formatting, and
 * this repository does not have a formatting problem.
 *
 * It lives here, in its own workspace package, for a reason that is not
 * tidiness. typescript-eslint cannot run on TypeScript 7 (upstream issue
 * 10940), and TypeScript's own answer is to run 6 and 7 side by side. `typescript`
 * is a peer dependency, so pnpm resolves it from whichever package imports the
 * linter — which means the only way to give the linter a 6.0 compiler while
 * everything that builds stays on 7.0.2 is for the linter to be a package of
 * its own. Scoped overrides were tried first and did nothing, for that reason.
 *
 * When typescript-eslint supports 7, this package collapses back into the root.
 *
 * There is deliberately no formatter. Adding one would rewrite every file, and
 * the thing a formatter buys — an end to style arguments — is not for sale
 * here, because the style is already consistent. The cost is permanent: every
 * `git blame` afterwards points at the reformat. That is a decision to take on
 * its own, not to smuggle in with a linter.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      'packages/db/src/generated.ts',
      // Deno, not Node: Edge Functions run on Supabase's runtime, with its own
      // globals (Deno, Supabase.ai) and no tsconfig here. Supabase bundles and
      // type-checks them on deploy.
      'supabase/functions/**',
      'services/eval/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Files no tsconfig owns: the Playwright config and its specs, the
          // Electron renderer, and the tooling that lints and guards. They are
          // still worth linting — the guard script is a control — so they get
          // the default project rather than an exemption.
          allowDefaultProject: [
            'playwright.config.ts',
            'e2e/*.ts',
            'scripts/*.mjs',
            'tools/lint/*.js',
            'apps/desktop/src/renderer/*.js',
          ],
        },
        // The repository root, not this package: the projects being linted
        // are up there, and this package holds only the linter.
        tsconfigRootDir: resolve(import.meta.dirname, '..', '..'),
      },
    },

    rules: {
      // ---- The ones with a story ------------------------------------------

      // The telemetry sinks fire and forget on purpose: recording must never
      // break or delay the thing being recorded. That intent is spelled `void
      // send(...)`, and without this rule dropping the `void` — or forgetting
      // an `await` somewhere that needed one — is a silent unhandled rejection
      // that looks identical in review.
      '@typescript-eslint/no-floating-promises': 'error',

      // An async function passed where a sync one is expected: the caller
      // never sees the rejection.
      '@typescript-eslint/no-misused-promises': 'error',

      // This found fifteen redundant casts by hand last week, one file at a
      // time. A cast that is no longer true is a claim the compiler has
      // stopped checking, and the whole point of generating the schema types
      // was to stop making those claims.
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',

      // `await` on something that is not a promise is almost always a missing
      // call or a misread signature.
      '@typescript-eslint/await-thenable': 'error',

      // `any` turns off every other rule here for whatever it touches. Where
      // one is genuinely needed it should be argued for in a comment, which is
      // what a disable line is.
      '@typescript-eslint/no-explicit-any': 'error',

      // ---- Turned down, with reasons --------------------------------------

      // The codebase reads database rows and HTTP bodies, which arrive as
      // unknown and are narrowed by hand at the boundary. That is the correct
      // shape for that code and this rule cannot tell it apart from carelessness.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // Template literals carrying a number or a boolean are how most of the
      // reporting in scripts/ is written, and it reads fine.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],

      // An unused argument named with a leading underscore is a documented
      // signature, not dead code.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Tests say things about types on purpose: a cross-tenant test asserts that
  // the database refuses what the type forbids, which it can only do by
  // building the forbidden thing. They also declare helpers async for a
  // uniform signature, which require-await reads as a mistake and which is
  // how a fake client is meant to look.
  {
    files: ['**/test/**/*.ts', '**/*.test.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      // A fake client is built by handing out its own methods as references,
      // which is the shape being faked.
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Config and plain JavaScript tooling are not part of a TypeScript project,
  // and they run in environments with globals: node for the scripts, the DOM
  // for the Electron renderer. Without saying so, every `console` and every
  // `document` reads as an undefined variable.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
        Blob: 'readonly',
        MediaRecorder: 'readonly',
        AbortController: 'readonly',
      },
    },
  },
);
