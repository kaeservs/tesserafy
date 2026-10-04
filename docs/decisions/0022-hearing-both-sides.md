# 0022 — The overlay hears both sides of a call, through Deepgram, without holding its key

**Status:** proposed · 2026-10-04

## Context

The overlay heard the call through the browser engine inside Electron. That
engine hears the microphone alone, and it labelled every line `customer`.
With headphones the customer was never heard at all. On speakers, the
seller's own questions were scored as if the customer had said them. That is
the mistake the detector prompt warns against: "A seller asking 'what's your
timeline?' is not evidence of a timeline." The engine also sends audio to
Google under Google's terms, not ours.

Cluely hears both sides. The owner chose a streaming vendor, Deepgram, over
running a model locally.

## Options

- **Two Deepgram streams opened by the overlay, with a short-lived token from
  the web app.**
  - One stream for the microphone (the seller) and one for the computer's
    sound output (what the meeting app plays: the customer).
  - Each side is labelled by where it came from, not by guessing voices.
  - The key stays on the server.
- **Audio through our own server to Deepgram.** The key never leaves the
  server and the server could meter every second. But the web app runs on
  Vercel functions, which cannot hold a WebSocket open for an hour.
- **One stream with both sides mixed, and diarization.** Half the streaming
  cost, but speakers are guessed. Which guessed voice is the seller is a
  second guess.
- **Whisper on the laptop.** Nothing leaves the machine, but it is not real
  time on an ordinary laptop's CPU, and it ships a model with the installer.

## Decision

**Two streams, opened by the overlay's main process, with a token the web
app mints.**

- **The token.**
  - `POST /api/live/transcription-token` gives a Deepgram token that lasts 60
    seconds (`/v1/auth/grant`), plus the stream address with every setting
    already chosen by the server.
  - It is only for someone whose plan includes Live and has live minutes left.
  - It is rate limited (10 a minute, 200 a day).
  - A stream opened with the token stays open after the token expires.
- **The streams.**
  - The main process holds them (`src/main/transcribe.ts`).
  - The page captures audio and sends it over IPC in quarter-second Opus
    chunks. It never opens a connection and never sees the token, so its CSP
    stays `connect-src 'none'`.
  - The address must begin with `wss://api.deepgram.com/` or it is not opened.
- **The settings** are `nova-3`, English, interim results, 300 ms endpointing,
  and an utterance end after a second of silence. Every stream sends
  `mip_opt_out=true`, so Deepgram may not use the audio to improve its models.
  Call audio is never used for anyone's own purposes.
- **The computer's sound** is asked for as `getDisplayMedia` with `loopback`
  audio.
  - The picture that call insists on is the overlay's own page, not the
    screen. It is dropped as soon as it arrives, so no screen is captured and
    the system draws no capture border.
  - Only the overlay's own page may ask for it.
  - Measured on Windows 11 with Electron 39: one sound track arrives, it stays
    live once the picture is dropped, and a tone played on the computer comes
    through in the Opus chunks (86 bytes a quarter-second silent, about 1.2 KB
    with the tone).
- **Echo.** On speakers the microphone hears the customer too. A microphone
  line waits 1.5 s, and it is dropped if most of its words were said by the
  customer within six seconds (`src/renderer/hearing.ts`).
- **Detection.**
  - Lines are saved as `seller` and `customer`.
  - Only the customer's lines start a detector call. The seller's lines sit in
    the window for context. So a call has no more T1 calls than before, and
    the criteria are still read from what the customer says.
- **Fallbacks.**
  - With no key in the deployment, setup says `transcription: null`, and the
    overlay uses the browser engine on the microphone, as before.
  - If no sound output can be had, the overlay streams the microphone alone,
    with no side named.
  - If the token is refused, the overlay falls back to the browser engine.

## Consequences

- **Switching it on** needs `DEEPGRAM_API_KEY` in the web app's environment, a
  key that can mint tokens. Deepgram's data processing agreement must be in
  place before customer calls go through it.
- **Cost is per streamed minute, per side.** Live minutes are still charged by
  detection, 5–30 seconds per customer line. The server cannot see how long a
  stream stays open, because it never carries the audio.
  - A modified client could stream for as long as a token's stream survives.
  - The defences are the rate limit, a four-hour cap in the overlay, and a
    spending limit set on the Deepgram project.
  - Exact metering needs Deepgram's usage API, read back per request, and is
    left for when payments exist.
- **macOS:** `loopback` audio needs a recent macOS. Where there is none, the
  overlay hears the microphone alone. This has not been tried on a Mac.
- **The browser engine stays** as the fallback. It is no longer how the
  product hears a call.
