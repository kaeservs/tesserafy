# 0029 — On a Mac, call detection reads Core Audio through a small Swift helper

**Status:** proposed · 2026-10-06

## Context

On Windows the overlay notices a call starting by reading which app is using
the microphone. Windows keeps that record in the registry
(`CapabilityAccessManager\ConsentStore\microphone`), and `reg query` reads it
every four seconds. When a meeting app takes the microphone, the overlay comes
up and offers Start. When the last one lets go, a running call stops after 15
seconds.

macOS keeps the same fact: it is what lights the microphone indicator in the
menu bar. But no command prints it. Since macOS 14.2, Core Audio has one
object per process using audio, and says of each whether it is running input
and what its bundle id is. That is native API, and Electron's main process
cannot call it.

## Options

1. **A native Node addon.** It would call Core Audio from inside the app.
   - It has to be rebuilt for every Electron version.
   - It drags node-gyp into a pnpm workspace whose overlay has no runtime
     dependencies.
   - A crash in it takes the overlay down with it.
2. **The unified log** (`log stream`). The microphone indicator's events are
   logged.
   - The messages are private and change between macOS releases.
   - Reading them reliably needs privileges a normal app does not have.
3. **The process list.** Zoom running is visible, but Zoom running is not a
   call.
   - A browser in a meeting looks the same as a browser doing anything else.
   - Windows covers Meet and Teams in a browser, so this would be worse than
     the Windows behaviour it is meant to match.
4. **A small Swift helper (chosen).** `native/mac/mic-users.swift` asks Core
   Audio once, prints the processes running input as JSON, and exits. The main
   process runs it on the same four-second timer as `reg query`, and a pure
   function in `src/main/calls.ts` turns its output into meeting apps, as it
   does for the registry.

## Decision

Option 4.

- **Build.** The helper is compiled on the Mac that builds the installers,
  for both chips (`swiftc`, then `lipo`), and is shipped beside the app's own
  executable (`Contents/MacOS/mic-users`), where it is signed with the app.
- **Meeting apps.** They are recognised by bundle-id prefix, because audio is
  often captured by a helper process:
  - Chrome's capture process is `com.google.Chrome.helper`;
  - Safari captures in WebKit's shared GPU process.

  Zoom, Teams, Webex, Slack and the common browsers count, under the same
  labels as on Windows. The overlay's own processes never count.
- **Older macOS.** Before 14.2 the helper says the record is unsupported, and
  the overlay stops asking.

## Consequences

- **CI proves it runs.** The macOS installer job checks that the helper is in
  both apps, carries both architectures, and reads the record on the runner.
  That proves it compiles and executes on a real Mac.
- **No Mac has run it in a call yet.** Three things are untested:
  - that each meeting app's capture process carries the bundle id expected
    here;
  - that a call ending reads as ended;
  - that the helper needs no permission beyond the overlay's own.

  These belong to the Mac test (S1). A bundle id that turns out different is
  a one-line change to `MAC_MEETING_APPS`.
- **A false positive** (a non-meeting app that matches) only brings the
  overlay up with Start offered. It never starts listening, because consent
  comes first (ADR 0020).
- **Spawning a process every four seconds** costs a few milliseconds each
  time. A long-running helper that pushes changes would be cheaper. It isn't
  worth that complexity until it is measured to matter.
