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

## Connecting it

    # PowerShell
    $env:TESSERAFY_URL   = 'https://web-beta-khaki-cxdkp6udxk.vercel.app'
    $env:TESSERAFY_TOKEN = '<a Supabase access token for a member>'
    pnpm --filter @tesserafy/desktop dev

Without a token the overlay still opens and says so — which is also all S1
needs, since that spike is about the window and not about what it displays.

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
