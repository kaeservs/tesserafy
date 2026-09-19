# @tesserafy/desktop

Electron desktop HUD. Built in Phase 7 — deliberately after the live path is
proven in the browser (Phase 6), so the realtime problem and the
desktop-window problem are debugged separately.

Right now it is spike **S1**'s apparatus and nothing more: a transparent,
always-on-top overlay whose only job is to answer whether
`setContentProtection(true)` keeps it out of a shared screen.

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
