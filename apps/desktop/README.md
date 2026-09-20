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

Detection is not wired to audio here. Spike S2 has not chosen a streaming
transcriber, and building one before it does means building the part most
likely to be thrown away. `window.pushEvent(detectorEvent)` from the devtools
console folds evidence in, which is enough to see the scorecard behave.

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
