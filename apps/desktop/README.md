# @tesserafy/desktop

Electron desktop HUD. Built in Phase 7 — deliberately after the live path is
proven in the browser (Phase 6), so the realtime problem and the
desktop-window problem are debugged separately.

It is two things at once: spike **S1**'s apparatus — a transparent,
always-on-top overlay whose job is to be looked for in a screen share — and
the beginning of the HUD itself, which renders a real scorecard.

The scorecard is computed by `@tesserafy/scoring`, the same package the web app
uses. That is why that package is allowed no runtime dependencies: the overlay
imports it, so the overlay cannot invent a score any more than the browser can.

It listens, detects, scores, and — when something just said makes it the
moment — shows one thing worth asking next (T2), with the customer's own words
underneath it. Suggestions are fetched only after the score is on screen, and
a stale one is cleared rather than left up: a seller asking about something
from two minutes ago is worse than a seller with no prompt at all.

It listens, detects and scores. Speech recognition is the browser engine
inside Electron — a stand-in until spike S2 chooses a streaming transcriber
that can run under our own terms, because this one sends audio off the
machine.

The session token never reaches the page. Detection and criteria are fetched
by the main process, so the renderer holds no credential: a renderer is a
browser, and a browser is where a credential gets read by something nobody
wrote.

## Signing in

The overlay signs in with the same username or email and password as the web
app (`src/main/session.ts`). The password goes from the form to the main
process once, on to Supabase Auth, and is not kept. The access token stays in
the main process's memory and is renewed before it expires. Only the refresh
token is saved, encrypted by the operating system through Electron's
`safeStorage` (DPAPI on Windows, the Keychain on macOS), in `session.bin`
under the app's user-data folder; where that encryption is unavailable nothing
is saved and the overlay asks each launch. *Sign out* ends this overlay's
session only — the web app stays signed in — and deletes the file.

It learns where Auth is from the web app's public `/auth/client-config`, so
the only setting is where the product is. That defaults to production:

    # PowerShell — only to point it somewhere else, e.g. a local web app
    $env:TESSERAFY_URL = 'http://localhost:3000'
    pnpm --filter @tesserafy/desktop dev

`TESSERAFY_TOKEN` is gone: a second way in is one more thing to leak. Signed
out, the overlay still opens — which is also all S1 needs, since that spike is
about the window and not about what it displays.

## Installing it

For anyone who is not building it: a Windows installer, `Tesserafy-Setup-<version>.exe`,
published to this repository's Releases by `.github/workflows/overlay.yml`
whenever a tag `overlay-v<version>` is pushed (the tag must match `version` in
`package.json`). It installs per user, with no administrator prompt, adds a
Start-menu and desktop shortcut, and its uninstaller removes the app, the
shortcuts and the saved sign-in.

It is not code-signed yet, so SmartScreen says "unknown publisher" (More info
→ Run anyway) until a certificate is configured in `electron-builder.yml`.

The shipped build turns off the Electron switches that let another program on
the machine drive it — running the exe as Node, `NODE_OPTIONS`, the inspector
— and checks its own package's integrity at start. The workflow refuses to
publish a build whose fuses do not read that way. A side effect: automated
tests cannot attach to the installed app; they run against the dev build.

To build one locally:

    pnpm --filter @tesserafy/desktop dist:win    # → apps/desktop/release/

## Running it

    pnpm --filter @tesserafy/desktop dev

**If it exits immediately with `Cannot read properties of undefined (reading
'whenReady')`**, check `ELECTRON_RUN_AS_NODE`. When that variable is set — some
editors and agent shells set it — the Electron binary runs as plain Node, so
`require('electron')` returns a path string instead of the API, and every
Electron call fails on undefined. Clear it and run again:

    # PowerShell
    Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

## What to test (spike S1)

The window starts with content protection **on**, and says so loudly. For each
of Zoom desktop, Meet in Chrome, and Teams:

1. Share the **entire screen**. Is the overlay in what participants see?
2. Share **a single window** (the meeting). Is it?
3. Toggle protection **off** and repeat. It *should* appear — that step proves
   the test itself is capable of detecting a failure.
4. With click-through on, can you still click the meeting underneath?

Record the answers in `docs/experiments/`. A "no" in step 3 means the test was
never valid, not that protection is unusually good.

Windows only so far. macOS uses a different mechanism and is untested; treat
any result here as saying nothing about it.
