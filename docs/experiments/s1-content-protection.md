# S1 — Does the overlay stay out of a shared screen?

**Question:** does `setContentProtection(true)` exclude the overlay from a
shared screen — Zoom desktop, Meet in Chrome, Teams; window share as well as
full-screen share?

**Status:** apparatus built and running, 2026-09-19. **Results pending a human
with a meeting.**

## Why this decides more than it looks like it does

If content protection does not hold, an always-on-top overlay is the wrong
shape for the product. A seller's private scorecard appearing in the
customer's view of the call is worse than having no scorecard: it is visible
evidence that the seller is being coached about the person they are talking
to, mid-conversation.

The fallbacks, if S1 fails, are all worse and all expensive — a second monitor,
a phone companion, a browser-tab HUD the seller keeps off-share by hand — so
this answer belongs before P7 rather than inside it.

## Apparatus

`apps/desktop`, run with `pnpm --filter @tesserafy/desktop dev`.

A transparent, frameless, always-on-top window at `screen-saver` level,
`skipTaskbar`, visible over full-screen meeting windows. It starts with
protection **on** — a spike that starts unprotected risks leaking a real
overlay into a real call while someone is still reading the instructions.

The window is deliberately loud: an orange border and a banner reading "IF YOU
SEE THIS IN THE SHARE, PROTECTION FAILED". A subtle overlay would make a
failed test look like a pass in a screenshot.

## Method

For each of Zoom desktop, Meet in Chrome, Teams:

| # | Step | Expected if protection works |
|---|---|---|
| 1 | Share entire screen | overlay absent from the share |
| 2 | Share a single window (the meeting) | overlay absent |
| 3 | Toggle protection off, repeat 1 | **overlay present** |
| 4 | Click-through on, click the meeting underneath | meeting responds |

Step 3 is not optional. Without it, "the overlay did not appear" is
indistinguishable from "the overlay was not running", and a spike that cannot
detect its own failure has not been run.

## Results

| Tool | Full-screen share | Window share | Protection off (control) | Click-through |
|---|---|---|---|---|
| Zoom desktop | | | | |
| Meet in Chrome | | | | |
| Teams | | | | |

Environment: Windows 11, Electron 39.2.6. macOS uses a different mechanism and
is untested — nothing measured here says anything about it.

## Notes from building it

`ELECTRON_RUN_AS_NODE=1` was set in the shell used to build this, which makes
the Electron binary run as plain Node: `require('electron')` returns a path
string, `app` is undefined, and the app exits before opening a window. The
error names none of that. Recorded in the desktop README because the next
person to hit it will otherwise suspect their own code.
