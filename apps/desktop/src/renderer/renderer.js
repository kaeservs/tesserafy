/**
 * The overlay: listen, detect, score.
 *
 * Scoring is @tesserafy/scoring — the same pure function the web app uses,
 * which is what invariant 5's no-runtime-dependencies rule buys. The overlay
 * cannot invent a score any more than the browser can.
 *
 * Transcription hears both sides (ADR 0022): the seller's microphone and the
 * computer's sound output — what the meeting app plays — each streamed to
 * Deepgram by the main process, each line labelled with its side. Where the
 * deployment has no transcriber yet, the browser engine inside Electron hears
 * the microphone alone, as before.
 *
 * The token is never here. Detection and criteria go through the main process,
 * so this page holds no credential — a renderer is a browser, and a browser is
 * where a credential gets read by something nobody wrote. Signing in passes a
 * password through once, to the main process, and keeps nothing.
 */
import { apply, defineCriteriaSet, initialState, score } from '@tesserafy/scoring';
import { questionsToAsk } from './to-ask';
import { EchoCheck, SELLER_HOLD_MS } from './hearing';
import { Captions } from './captions';
import { TalkMeter } from './talk-time';

const api = window.overlay;
const WINDOW_SIZE = 3;

let state = null;
let prompts = [];
const utterances = [];
// Where the current call's lines begin: one sitting can hold several calls,
// and what Assist reads, or a recap sums up, is this call's alone.
let callStart = 0;
const thisCall = () => utterances.slice(callStart);
let protection = true;
let clickThrough = false;
let listening = false;
// Whether the main process holds a session. Listen is offered only then.
let signedIn = false;
let recognition = null;
// Both sides being transcribed: how to stop the capture, and whether only the
// microphone could be had (then no line can be said to be either side's).
let capture = null;
let micOnly = false;
let echoes = new EchoCheck();
const MAX_CALL_MS = 4 * 60 * 60 * 1000;
// The live transcript on screen, and who is doing the talking (both sides only).
const captions = new Captions(3);
let talk = null;
let nudgeTimer = null;
const SIDE_NAME = { me: 'You', them: 'Them' };

function showCaptions() {
  const lines = captions.lines(performance.now());
  const box = el('captions');
  box.replaceChildren(
    ...lines.map((line) => {
      const p = document.createElement('p');
      if (line.side) {
        const side = document.createElement('span');
        side.className = 'side';
        side.textContent = SIDE_NAME[line.side];
        p.append(side);
      }
      const words = document.createElement('span');
      if (line.live) words.className = 'live';
      words.textContent = line.text;
      p.append(words);
      return p;
    }),
  );
  box.hidden = !listening || lines.length === 0;
}

function showTalk() {
  if (!talk) {
    el('talkTime').hidden = true;
    return;
  }
  const now = performance.now();
  const shares = talk.shares();
  // A share of a handful of words says nothing yet.
  el('talkTime').hidden = shares.words < 30;
  el('talkTime').textContent = `You ${Math.round(shares.me * 100)}% · Them ${Math.round(shares.them * 100)}% of the talking`;
  const nudge = talk.nudge(now);
  if (nudge) {
    el('talkNudge').textContent = nudge;
    el('talkNudge').hidden = false;
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
      el('talkNudge').hidden = true;
    }, 20_000);
  }
}
let sessionStart = 0;
const latencies = [];
// Which suggestion request is the current one. Speech does not wait for the
// network, so two are often in flight, and without this the slower of them
// wins the screen — which is how a suggestion about something said a minute
// ago replaces one about the sentence just spoken.
let suggestSeq = 0;

/*
 * Keeping the call.
 *
 * The conversation exists from the moment Listen is pressed, so a call that
 * ends in a crashed overlay is still a call that happened. A meeting cannot
 * be re-run.
 *
 * `serverIds` is the whole subtlety. A detector event names its segment by
 * the local id the window used — the utterance was still in flight when
 * detection began — and the database knows it by the id it assigned. So each
 * local id holds a promise of a server id, and the evidence post waits on the
 * ones its events mention. Waiting costs nothing there: the score is drawn.
 *
 * Every failure here is quiet. A saved call is worth having and no part of it
 * is worth interrupting a meeting for.
 *
 * This mirrors apps/web/lib/live-session.ts, which writes through fetch rather
 * than IPC. The transports differ and the rule must not: a change to one is a
 * change to the other, and apps/web/test/live-session.test.ts is where the
 * behaviour is pinned.
 */
let conversationId = null;
const serverIds = new Map();
let savedSegments = 0;
let savedEvents = 0;
let lostWrites = 0;

const el = (id) => document.getElementById(id);
const setStatus = (text) => {
  el('status').textContent = text;
};

function render() {
  if (!state) return;
  const card = score(state);
  const confirmed = card.criteria.filter((criterion) => criterion.status === 'confirmed').length;

  const rounded = Math.round(card.score);
  el('scoreValue').textContent = String(rounded);
  el('scoreFill').style.width = `${Math.max(0, Math.min(100, rounded))}%`;
  el('scoreMeter').setAttribute('aria-valuenow', String(rounded));
  // Built as nodes, never as HTML: a label is whatever a company's owner
  // typed into their scorecard, and markup in it would run in this window.
  el('criteria').replaceChildren(
    ...card.criteria.map((criterion) => {
      const item = document.createElement('li');
      item.className = criterion.status;
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = criterion.label;
      item.append(label);
      // Numbers only, not the sentence the web app writes. Phrasing it here
      // too would be a second copy of the wording to keep in step, and there
      // is no room for a sentence in a chip anyway — what a seller needs
      // mid-call is "one more mention", which `1/2` says.
      const short = criterion.shortfall;
      if (short && short.segmentsNeeded > 1) {
        const hint = document.createElement('span');
        hint.className = 'hint';
        hint.textContent = `${short.segments}/${short.segmentsNeeded}`;
        item.append(hint);
      }
      const status = document.createElement('span');
      status.className = `state ${criterion.status}`;
      // Read out, and shown on hover; on the chip it is the mark.
      status.textContent = criterion.status;
      item.prepend(status);
      item.title = `${criterion.label}: ${criterion.status}${short && short.segmentsNeeded > 1 ? ` (${short.segments} of ${short.segmentsNeeded} mentions)` : ''}`;
      return item;
    }),
  );

  renderToAsk(card);

  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  setStatus(`${confirmed}/${card.criteria.length} confirmed${p50 ? ` · ${p50} ms p50` : ''}`);

  // Whether the call is being kept, said while it is happening. An overlay
  // that silently failed to save would be discovered afterwards, by somebody
  // looking for a meeting that is not there.
  const keeping = el('keeping');
  if (keeping) {
    if (conversationId) {
      keeping.textContent =
        `saving · ${savedSegments} utterance${savedSegments === 1 ? '' : 's'}, ` +
        `${savedEvents} evidence${lostWrites > 0 ? ` · ${lostWrites} failed` : ''}`;
    } else {
      keeping.textContent = listening ? 'not being saved' : '';
    }
  }
}

/** The customer this call is with: the dashboard's next call says who (/api/live/setup). */
let chosenAccount = null;
/** What the dashboard set up for the next call: customer, scorecard, prep. */
let setup = null;
/** The prep's questions for this customer's call, each naming its criterion. */
let preparedQuestions = [];

const OUTCOME = { won: 'Won', lost: 'Lost', open: 'Still open' };
const SAID = { problem: 'Problem', feature_request: 'Asked for' };

function line(text, className) {
  const p = document.createElement('p');
  p.textContent = text;
  if (className) p.className = className;
  return p;
}

async function showBrief(id) {
  const brief = el('brief');
  preparedQuestions = [];
  if (!id) {
    brief.hidden = true;
    return;
  }
  const result = await api.brief(id);
  if (result.error || id !== chosenAccount) {
    brief.hidden = true;
    return;
  }
  preparedQuestions = result.prep?.questions ?? [];
  const parts = [];
  const standing = [
    `${result.calls} call${result.calls === 1 ? '' : 's'} before`,
    result.outcome ? OUTCOME[result.outcome] ?? result.outcome : null,
  ].filter(Boolean);
  parts.push(line(standing.join(' · '), 'dim'));
  if (result.last) {
    const when = new Date(result.last.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    parts.push(line(`Last: ${result.last.title}, ${when}${result.last.score === null ? '' : ` — scored ${result.last.score}`}`));
  }
  if ((result.said ?? []).length > 0) {
    const list = document.createElement('ul');
    for (const item of result.said) {
      const li = document.createElement('li');
      li.textContent = `${SAID[item.kind] ?? item.kind}: ${item.summary}${item.quote ? ` — “${item.quote}”` : ''}`;
      list.append(li);
    }
    parts.push(list);
  }
  for (const note of result.notes ?? []) parts.push(line(`Note: ${note}`, 'dim'));
  if (result.prep) {
    const prep = document.createElement('div');
    prep.className = 'prep';
    prep.append(line(`Prepared for ${result.prep.person}`, 'dim'));
    if (result.prep.openWith) prep.append(line(`Open with: ${result.prep.openWith}`));
    if (result.prep.questions.length > 0) {
      const list = document.createElement('ul');
      for (const question of result.prep.questions) {
        const li = document.createElement('li');
        li.textContent = `Ask: ${question.ask}`;
        list.append(li);
      }
      prep.append(list);
    }
    parts.push(prep);
  }
  brief.replaceChildren(...parts);
  brief.hidden = false;
}

/** The scorecard for the next call, by name, as the dashboard set it. */
let chosenScorecard = null;

/**
 * The next call as the dashboard set it up: which customer, which scorecard,
 * which prep, and how the overlay looks. Read on sign-in and again before
 * each call, so a change made in the dashboard is picked up without asking.
 */
async function loadSetup() {
  const result = await api.setup();
  if (result.error) {
    setStatus(result.error);
    return false;
  }
  setup = result;
  if (result.appearance) showAppearance(result.appearance);
  // Offered only where the company allows it (Settings, in the dashboard).
  el('screenToggle').hidden = result.screen !== true;
  if (result.screen !== true) setScreen(false);
  chosenScorecard = result.engagementType ?? null;
  chosenAccount = result.account?.id ?? null;
  askPlaceholder();
  showAgreement();
  el('nextCall').textContent = result.prep
    ? `${result.prep.person}${result.account ? `, ${result.account.name}` : ''}`
    : result.account
      ? result.account.name
      : 'No call prepared — set one up in Tesserafy';
  void showBrief(chosenAccount);
  showMeeting();
  return true;
}

/*
 * The next meeting, from the calendar (lib/live-setup): "Northwind discovery
 * in 5 min", with its prep — opened in the dashboard, or made in one press if
 * there is none. The setup is read again every two minutes while not on a
 * call, so a meeting coming up is noticed; two minutes before it starts the
 * overlay comes up, without taking focus, once a meeting.
 */
const SURFACE_BEFORE_MS = 2 * 60_000;
let surfacedFor = null;
function meetingWhen(startsAt) {
  const minutes = Math.round((Date.parse(startsAt) - Date.now()) / 60_000);
  return minutes > 0 ? `in ${minutes} min` : 'now';
}
function showMeeting() {
  const meeting = setup?.meeting ?? null;
  const banner = el('meetingBanner');
  if (!meeting || listening || !signedIn) {
    banner.hidden = true;
    return;
  }
  el('meetingText').textContent = `${meeting.title} ${meetingWhen(meeting.startsAt)}`;
  el('meetingAction').textContent = meeting.prepId ? 'Open prep' : 'Prepare';
  banner.hidden = false;
  if (surfacedFor !== meeting.id && Date.parse(meeting.startsAt) - Date.now() <= SURFACE_BEFORE_MS) {
    surfacedFor = meeting.id;
    void api.surface();
  }
}
el('meetingAction').addEventListener('click', async () => {
  const meeting = setup?.meeting;
  if (!meeting) return;
  if (meeting.prepId) {
    void api.openPrep(meeting.prepId);
    return;
  }
  el('meetingAction').disabled = true;
  const made = await api.prepareMeeting(meeting.id);
  el('meetingAction').disabled = false;
  if (made.error || !made.prepId) {
    setStatus(made.error ?? 'That meeting could not be prepared.');
    return;
  }
  // The prep is now the call's: read the setup again so the bar says so.
  await loadSetup();
  setStatus('Prepared. Write its brief in Tesserafy, from Open prep.');
});
setInterval(() => {
  if (signedIn && !listening) void loadSetup();
}, 2 * 60_000);
setInterval(() => {
  if (!el('meetingBanner').hidden) showMeeting();
}, 30_000);

async function loadCriteria() {
  const result = await api.criteria(chosenScorecard ?? undefined);
  if (result.error) {
    setStatus(result.error);
    return false;
  }

  const rows = result.criteria ?? [];
  if (rows.length === 0) {
    setStatus('no criteria returned');
    return false;
  }

  prompts = rows.map((row) => ({ key: row.key, label: row.label, definition: row.definition }));
  state = initialState(
    defineCriteriaSet({
      engagementType: rows[0].engagement_type,
      version: rows[0].version,
      criteria: rows.map((row) => ({
        key: row.key,
        label: row.label,
        weight: row.weight,
        thresholds: {
          candidate: row.candidate_threshold,
          confirm: row.confirm_threshold,
          corroboratingSegments: row.corroborating_segments,
        },
      })),
    }),
  );
  el('engagement').textContent = `${rows[0].engagement_type} v${rows[0].version}`;
  render();
  return true;
}

async function startSession() {
  const when = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const result = await api.liveStart({
    title: `Live call — ${when}`,
    engagementType: state?.criteriaSet?.engagementType ?? 'discovery',
    criteriaVersion: state?.criteriaSet?.version ?? 1,
    ...(chosenAccount ? { accountId: chosenAccount } : {}),
  });

  if (result.error || !result.conversationId) {
    // Not being able to keep the call must not stop it being run.
    conversationId = null;
    lostWrites += 1;
    return;
  }
  conversationId = result.conversationId;
  render();
}

/** Fired alongside detection, never before it. */
function appendSegment(utterance) {
  if (!conversationId) return;

  serverIds.set(
    utterance.id,
    api
      .liveSegment(conversationId, {
        speaker: utterance.speaker,
        startMs: utterance.startMs,
        endMs: utterance.endMs,
        text: utterance.text,
      })
      .then((result) => {
        if (result.error || !result.segmentId) {
          lostWrites += 1;
          render();
          return null;
        }
        savedSegments += 1;
        render();
        return result.segmentId;
      })
      .catch(() => {
        lostWrites += 1;
        return null;
      }),
  );
}

async function saveEvents(events, detector, model) {
  if (!conversationId || events.length === 0) return;

  const resolved = await Promise.all(
    events.map(async (event) => {
      const segmentId = await (serverIds.get(event.span.segmentId) ?? Promise.resolve(null));
      // An event whose segment never reached the server is dropped rather
      // than sent with a guessed id. Evidence pointing at nothing is worse
      // than evidence that is missing: only one of them is visibly absent.
      if (!segmentId) return null;
      return {
        criterionKey: event.criterionKey,
        kind: event.kind,
        confidence: event.confidence,
        segmentId,
        quote: event.span.quote,
        detector,
        model,
      };
    }),
  );

  const sendable = resolved.filter(Boolean);
  if (sendable.length === 0) return;

  const result = await api.liveEvents(conversationId, { events: sendable });
  if (result.error) {
    lostWrites += 1;
  } else {
    // A rejected claim is the quote rule working, not a dropped write.
    savedEvents += result.recorded ?? 0;
  }
  render();
}

async function detect(endedAt) {
  const window_ = thisCall().slice(-WINDOW_SIZE);
  const result = await api.detect({ criteria: prompts, window: window_ });
  if (result.error) {
    setStatus(result.error);
    return;
  }

  // Latching state means an overlapping window cannot double-count, so the
  // same evidence arriving twice is harmless.
  for (const event of result.events ?? []) {
    state = apply(state, event);
  }
  latencies.push(Math.round(performance.now() - endedAt));
  render();

  // Both of these only after the score is on screen. A suggestion is allowed
  // to be late and so is a write; a score is not.
  void suggest(window_);
  void saveEvents(result.events ?? [], result.detector ?? 'unknown', result.model ?? 'unknown');
}

async function suggest(window_) {
  const seq = ++suggestSeq;
  const result = await api.suggest({ scorecard: score(state), window: window_ });
  // A later request has already been made: this answer is about a window that
  // is no longer what is being talked about, so it is dropped rather than
  // shown. Silence beats a stale question.
  if (seq !== suggestSeq) return;
  if (result.error) return;
  showSuggestion(result.suggestion ?? null);
}

function showSuggestion(suggestion) {
  const box = el('suggestion');
  if (!suggestion) {
    // Silence is the default. Leaving a stale suggestion up would have the
    // seller asking about something two minutes out of date.
    box.hidden = true;
    return;
  }
  el('suggestionAsk').textContent = suggestion.ask;
  el('suggestionWhy').textContent = `because they said “${suggestion.because}”`;
  box.hidden = false;
}

/** One line heard, kept and — when it is the customer's — detected on. */
function heardLine(text, speaker, detecting) {
  const endedAt = performance.now();
  const utterance = {
    id: `u${utterances.length}`,
    speaker,
    startMs: Math.round(endedAt - sessionStart),
    endMs: Math.round(endedAt - sessionStart),
    text,
  };
  utterances.push(utterance);
  if (talk && speaker) {
    talk.heard(speaker === 'seller' ? 'me' : 'them', text, endedAt);
    showTalk();
  }

  // Alongside detection, not before it: saving an utterance must never
  // sit between somebody finishing a sentence and the score moving.
  appendSegment(utterance);
  // The seller's own lines are in the window for context, and are not worth
  // a detector call of their own: the criteria are about what the customer
  // says, and the customer's next line is detected with them in view.
  if (detecting) void detect(endedAt);
}

async function startListening() {
  sessionStart = performance.now();
  if (setup?.transcription === 'deepgram' && (await startBothSides())) {
    began(micOnly ? 'listening — your microphone only' : 'listening to both sides');
    return;
  }
  startEngine();
}

function began(status) {
  listening = true;
  callStart = utterances.length;
  el('meetingBanner').hidden = true;
  askPlaceholder();
  el('listen').textContent = 'Stop';
  // The brief was for walking in; the scorecard is for the call, with the
  // prep's questions beside it.
  el('brief').hidden = true;
  render();
  setStatus(status);

  // Not awaited. The first utterance can be detected before the conversation
  // exists; its write simply finds no session and is skipped.
  void startSession();
}

/** The call is over, however it ended. */
/*
 * When a call ends: what was said, what was agreed, what is still open — the
 * Recap button's answer, every point quoting the call, without pressing it.
 * After a moment, so the last words still arriving from the streams are in
 * it, and only for a call with something to sum up. Not charged to the plan,
 * as the button is not.
 */
const RECAP_AFTER_MS = 2_500;
const RECAP_LINES = 4;
function recapCall() {
  setTimeout(() => {
    if (listening || !signedIn || thisCall().length < RECAP_LINES) return;
    void runAssist('call-recap');
  }, RECAP_AFTER_MS);
}

function ended() {
  listening = false;
  recapCall();
  cancelAutoStop();
  captions.clear();
  showCaptions();
  talk = null;
  showTalk();
  el('talkNudge').hidden = true;
  askPlaceholder();
  el('listen').textContent = 'Start';
  // What Cluely hands over when the meeting ends: here, the follow-up email,
  // drafted in the dashboard when the seller asks for it there.
  const call = conversationId;
  if (call) {
    showCall('Call saved. Draft the follow-up email?', 'Follow-up', () => {
      el('callBanner').hidden = true;
      void api.openFollowUp(call);
    });
  }
}

function stopListening() {
  if (capture) {
    const stopping = capture;
    capture = null;
    // The last quarter-second reaches the stream before it is closed, and
    // the last words heard come back as the streams close.
    void stopping.stop().then(() => api.transcribeStop());
    ended();
    return;
  }
  recognition?.stop();
}

/*
 * Both sides (ADR 0022). The microphone is the seller; the computer's sound
 * output — asked for as a capture of this page with the system's sound, the
 * picture dropped at once — is the meeting app playing the customer. Each is compressed here and sent to
 * the main process a quarter-second at a time; the main process holds the
 * streams and says what was heard. Nothing is recorded or kept: audio goes
 * to the transcriber for this call's text and nowhere else.
 */
function stopTracks(stream) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function record(stream, channel) {
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32_000 });
  // In order: a stream of compressed audio is one file cut in pieces.
  let sent = Promise.resolve();
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;
    sent = sent
      .then(() => event.data.arrayBuffer())
      .then((buffer) => api.sendAudio(channel, buffer))
      .catch(() => {});
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve(sent);
  });
  recorder.start(250);
  return { recorder, stopped };
}

async function startBothSides() {
  let mic = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    setStatus('the microphone is not available');
    return false;
  }
  let system = null;
  try {
    const shared = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    for (const track of shared.getVideoTracks()) track.stop();
    if (shared.getAudioTracks().length > 0) system = new MediaStream(shared.getAudioTracks());
  } catch {
    // Some systems give no sound output to capture. The microphone alone
    // still hears the seller, and the customer too when on speakers.
    system = null;
  }

  const opened = await api.transcribeStart();
  if (opened.error) {
    stopTracks(mic);
    stopTracks(system);
    setStatus(opened.error);
    return false;
  }

  micOnly = system === null;
  echoes = new EchoCheck();
  captions.clear();
  // Talk time needs the two sides apart; one microphone cannot say whose.
  talk = micOnly ? null : new TalkMeter(performance.now());
  const recorders = [record(mic, 'me'), ...(system ? [record(system, 'them')] : [])];
  // A stream costs for as long as it is open, and nothing on the server can
  // see how long that is; a call forgotten with Stop unpressed ends here.
  const forgotten = setTimeout(() => {
    if (!capture) return;
    stopListening();
    setStatus('stopped listening after four hours');
  }, MAX_CALL_MS);
  capture = {
    stop: async () => {
      clearTimeout(forgotten);
      for (const { recorder } of recorders) if (recorder.state !== 'inactive') recorder.stop();
      await Promise.all(recorders.map(({ stopped }) => stopped));
      stopTracks(mic);
      stopTracks(system);
    },
  };
  return true;
}

api.onTranscript(({ channel, kind, text }) => {
  const side = micOnly ? null : channel;
  // The seller's finished line waits for the echo check below before it is a
  // caption; everything else shows as it comes.
  if (kind === 'interim' || side !== 'me') {
    captions.heard(side, kind, text, performance.now());
    showCaptions();
  }
  if (kind !== 'utterance' || text.length === 0) return;
  if (micOnly) {
    // One microphone cannot say whose line it is.
    heardLine(text, null, true);
    return;
  }
  if (channel === 'them') {
    echoes.heardThem(text, performance.now());
    heardLine(text, 'customer', true);
    return;
  }
  // The seller's line waits for the customer's copy of it, in case it is one.
  const at = performance.now();
  const check = echoes;
  setTimeout(() => {
    const echo = check.isEcho(text, at);
    // An echo is the customer's sentence again: its live guess goes, and no line stays.
    captions.heard('me', echo ? 'interim' : 'utterance', echo ? '' : text, performance.now());
    showCaptions();
    if (!echo) heardLine(text, 'seller', false);
  }, SELLER_HOLD_MS);
});

// A stream that drops mid-call is said, not hidden; the call carries on with
// whatever side still has one.
api.onTranscriptTrouble(({ message }) => setStatus(message));

/** The browser engine: the microphone alone, as one unnamed side. */
function startEngine() {
  const Engine = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Engine) {
    setStatus('no speech recognition in this build');
    return;
  }

  recognition = new Engine();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-GB';

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript.trim();
      captions.heard(null, result.isFinal ? 'utterance' : 'interim', text, performance.now());
      showCaptions();
      if (!result.isFinal || text.length === 0) continue;
      heardLine(text, 'customer', true);
    }
  };

  // 'no-speech' fires on any quiet stretch. Announcing it mid-call would be
  // worse than the silence it reports.
  recognition.onerror = (event) => {
    if (event.error !== 'no-speech') setStatus(`speech: ${event.error}`);
  };
  recognition.onend = () => ended();

  recognition.start();
  began('listening');
}

/*
 * The one-time recording agreement (ADR 0020). Shown until the person agrees,
 * once; from then on Start is one press. The words come from the server, which
 * keeps what was agreed to as the record every call cites.
 */
let agreed = false;
function showAgreement() {
  agreed = Boolean(setup?.agreement);
  el('agreementText').textContent = setup?.agreementText ?? '';
  el('agreement').hidden = agreed || !signedIn;
  el('listen').disabled = (!agreed || !signedIn) && !listening;
}
el('agreeButton').addEventListener('click', async () => {
  el('agreeButton').disabled = true;
  const result = await api.agree();
  el('agreeButton').disabled = false;
  if (result.error) {
    setStatus(result.error);
    return;
  }
  setup = { ...(setup ?? {}), agreement: { agreedAt: result.agreedAt, termsVersion: result.termsVersion } };
  showAgreement();
});

el('listen').addEventListener('click', () => {
  if (listening) {
    stopListening();
    return;
  }
  if (!agreed || !signedIn) return;
  // Set up afresh: the next call may have changed in the dashboard since.
  void loadSetup()
    .then(() => loadCriteria())
    .then((ready) => ready && startListening());
});

// The main process owns both switches, and the tray changes them too; the
// buttons show what it says rather than what was last clicked here.
// Where the icon is, in the words each system uses: once click-through is on
// it is the only way back, so the button says where to look.
let trayPlace = 'the tray';
void api.platform().then((p) => {
  trayPlace = p.platform === 'darwin' ? 'the menu bar' : 'the taskbar corner';
});

// The keyboard shortcuts as they read on this system, and whether they are
// ours — another app may own them (see src/main/shortcuts.ts). The tray lists
// them all; the ask box says the one for Assist.
let keys = { visible: null, clickThrough: null, assist: null, move: null };
// Before a call the box asks past calls; during one, this call (askForm).
function askPlaceholder() {
  if (!listening && utterances.length === 0) {
    el('askInput').placeholder = setup?.account ? `Ask about past calls with ${setup.account.name}` : 'Ask about your past calls';
    return;
  }
  el('askInput').placeholder = keys.assist?.available
    ? `Ask about the call — or ${keys.assist.keys} for Assist`
    : 'Ask about the call — or Ctrl+Enter here for Assist';
}
void api.config().then((config) => {
  keys = config.shortcuts;
  askPlaceholder();
});

function showSwitches(state) {
  protection = state.protection;
  clickThrough = state.clickThrough;
  el('unprotected').hidden = protection;
  // With click-through on nothing here can be clicked, so it says how to
  // turn it off; the switch itself is the shortcut and the tray.
  el('clickNote').hidden = !clickThrough;
  el('clickNote').textContent = `Click-through on — ${keys.clickThrough?.available ? `${keys.clickThrough.keys} or ` : ''}the Tesserafy icon in ${trayPlace} turns it off`;
}
api.onState(showSwitches);

el('termsLink').addEventListener('click', () => void api.openTerms());
el('hide').addEventListener('click', () => void api.hide());

/*
 * A call started or ended (main/calls): say so, and offer the next step.
 * Starting is the seller's: Start needs the one-time agreement, as always.
 */
let callAction = null;
function showCall(text, label, action) {
  el('callText').textContent = text;
  el('callAction').textContent = label;
  el('callAction').hidden = !label;
  callAction = action;
  el('callBanner').hidden = false;
}
el('callAction').addEventListener('click', () => callAction?.());
el('callDismiss').addEventListener('click', () => {
  el('callBanner').hidden = true;
});
/*
 * The meeting app let go of the microphone while we were listening: the call
 * is over, so the overlay stops by itself after a short grace — a dropped
 * connection or a device switch comes back within it — and offers the
 * follow-up. "Keep listening" cancels it. Only where calls are noticed at all
 * (Windows, and not switched off in the dashboard).
 */
const AUTO_STOP_S = 15;
let autoStop = null;
function cancelAutoStop() {
  if (autoStop) clearInterval(autoStop);
  autoStop = null;
}
function startAutoStop() {
  cancelAutoStop();
  let left = AUTO_STOP_S;
  const say = () => {
    el('callText').textContent = `The call ended. Stopping in ${left} s.`;
  };
  showCall('', 'Keep listening', () => {
    cancelAutoStop();
    el('callBanner').hidden = true;
  });
  say();
  autoStop = setInterval(() => {
    left -= 1;
    if (left > 0) {
      say();
      return;
    }
    cancelAutoStop();
    if (listening) stopListening();
  }, 1_000);
}

api.onCall((call) => {
  if (!signedIn) return;
  if (call.active && !listening) {
    showCall(`${call.app} is using your microphone — a call?`, 'Start', () => {
      if (!agreed) {
        el('callText').textContent = 'Agree once to record your calls (below), then Start.';
        el('agreeButton').focus();
        return;
      }
      el('callBanner').hidden = true;
      el('listen').click();
    });
  } else if (call.active && listening) {
    // Back on the call before the countdown ran out: keep listening.
    if (autoStop) {
      cancelAutoStop();
      el('callBanner').hidden = true;
    }
  } else if (!call.active && listening) {
    startAutoStop();
  } else if (!call.active) {
    el('callBanner').hidden = true;
  }
});

/*
 * Cluely's four buttons and ask box (/api/assist). Each reads the call so far
 * and the prep for it. A point about the call carries the words it rests on,
 * shown under it; the server has already dropped any whose words the call
 * did not say. A later press replaces an earlier answer still on its way.
 */
const ASSIST_TITLE = {
  assist: 'Assist',
  say: 'What to say',
  followups: 'Follow-up questions',
  recap: 'Recap',
  ask: 'Answer',
  'call-recap': 'Call recap',
};
let assistSeq = 0;
let withScreen = false;

function setScreen(on) {
  withScreen = on;
  el('screenToggle').setAttribute('aria-pressed', String(on));
}
el('screenToggle').addEventListener('click', () => setScreen(!withScreen));

async function runAssist(mode, question) {
  if (!signedIn) return;
  const seq = ++assistSeq;
  // One screenshot per press: the toggle switches itself off once used.
  const screenshot = withScreen;
  setScreen(false);
  el('answer').hidden = false;
  el('answerTitle').textContent = `${ASSIST_TITLE[mode]}${screenshot ? ' · with your screen' : ''} · thinking…`;
  el('answerPoints').replaceChildren();
  el('answerPoints').replaceChildren();
  const result = await api.assist({
    mode: mode === 'call-recap' ? 'recap' : mode,
    ...(question ? { question } : {}),
    transcript: thisCall().map(({ id, speaker, text }) => ({ id, speaker, text })),
    criteria: state ? score(state).criteria.map((c) => ({ key: c.key, label: c.label, status: c.status })) : [],
    ...(setup?.prep ? { prepId: setup.prep.id } : {}),
    engagementType: chosenScorecard ?? state?.criteriaSet?.engagementType ?? 'discovery',
  }, screenshot, seq);
  if (seq !== assistSeq) return;
  if (result.error) {
    el('answerTitle').textContent = `${ASSIST_TITLE[mode]} · ${result.error}`;
    return;
  }
  el('answerTitle').textContent = question ? `${ASSIST_TITLE[mode]} · ${question}` : ASSIST_TITLE[mode];
  const points = result.points ?? [];
  if (points.length === 0) {
    const li = document.createElement('li');
    li.textContent = thisCall().length === 0 ? 'Nothing said yet to go on.' : 'Nothing worth saying yet.';
    el('answerPoints').replaceChildren(li);
    return;
  }
  // The same points as arrived one by one; set whole so the list is exactly
  // the checked answer.
  el('answerPoints').replaceChildren(...points.map(pointItem));
}

function pointItem(point) {
  const li = document.createElement('li');
  li.textContent = point.text;
  if (point.quote) {
    const quote = document.createElement('span');
    quote.className = 'quote';
    // From the company's knowledge, the document says where; from the
    // call, the quote is the customer's own words.
    quote.textContent = point.fromScreen
      ? `“${point.quote}” — on your screen`
      : point.document
        ? `“${point.quote}” — ${point.document}`
        : `“${point.quote}”`;
    li.append(quote);
  }
  return li;
}

// Points of the answer being written, shown as they are checked. A part for
// an earlier question (a later press replaced it) is left out.
api.onAssistPart((part) => {
  if (part.seq !== assistSeq) return;
  el('answerPoints').append(pointItem(part.point));
});

for (const button of document.querySelectorAll('[data-assist]')) {
  button.addEventListener('click', () => void runAssist(button.dataset.assist));
}
/*
 * Before a call, the box asks past calls ("Ask your calls"): what this
 * customer said last time, what was promised, what the documents say. It is
 * seconds rather than one, which is fine while getting ready and not while
 * someone is talking — so once listening, or once anything was said, the box
 * is Assist's Ask, about this call.
 */
function askPointItem(point) {
  const li = document.createElement('li');
  li.textContent = point.text;
  const quote = document.createElement('span');
  quote.className = 'quote';
  const where = point.call
    ? `${point.call.speaker ?? 'Someone'}, ${point.call.title}${point.call.occurredAt ? `, ${new Date(point.call.occurredAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}`
    : point.document ?? '';
  quote.textContent = `“${point.quote}”${where ? ` — ${where}` : ''}`;
  li.append(quote);
  if (point.href) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'link';
    open.textContent = 'Open';
    open.addEventListener('click', () => void api.openCall(point.href));
    li.append(' ', open);
  }
  return li;
}

async function runAskCalls(question) {
  if (!signedIn) return;
  const seq = ++assistSeq;
  const about = setup?.account ? `Past calls with ${setup.account.name}` : 'Past calls';
  el('answer').hidden = false;
  el('answerTitle').textContent = `${about} · looking…`;
  el('answerPoints').replaceChildren();
  const result = await api.askCalls(question, setup?.account?.id ?? null, seq);
  if (seq !== assistSeq) return;
  if (result.error) {
    el('answerTitle').textContent = `${about} · ${result.error}`;
    return;
  }
  el('answerTitle').textContent = `${about} · ${question}`;
  const items = (result.points ?? []).map(askPointItem);
  if (result.note || items.length === 0) {
    const li = document.createElement('li');
    li.textContent = result.note || 'Nothing in your past calls answers that.';
    items.push(li);
  }
  el('answerPoints').replaceChildren(...items);
}

// What the agent is doing, in the title while it works.
api.onAskStep((step) => {
  if (step.seq !== assistSeq) return;
  const about = setup?.account ? `Past calls with ${setup.account.name}` : 'Past calls';
  el('answerTitle').textContent = `${about} · ${step.text}…`;
});

el('askForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const question = el('askInput').value.trim();
  if (!question) return;
  el('askInput').value = '';
  if (!listening && utterances.length === 0) void runAskCalls(question);
  else void runAssist('ask', question);
});
// Ctrl+Enter in the box is Assist, as in Cluely; the global shortcut is for
// when the meeting, not the overlay, has the keyboard.
el('askInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void runAssist('assist');
  }
});
api.onAssistKey(() => void runAssist('assist'));

/*
 * Appearance: theme, accent and background, as set in the dashboard and
 * applied by the main process (overlay:setup). Size and position move the
 * window, which only the main process can do.
 */
function showAppearance(look) {
  const root = document.documentElement;
  root.dataset.theme = look.theme;
  root.dataset.accent = look.accent;
  root.style.setProperty('--alpha', String(look.opacity / 100));
}

void api.appearance().then(showAppearance);

/*
 * A newer overlay. The main process checks and holds the address; this line
 * only says so, and "Download" asks the main process to open the page.
 * "Later" hides one version for the rest of this run, not for good: the next
 * start says it again.
 */
let laterFor = null;
let offered = null;
let noteTimer = null;

function showUpdate(state) {
  const box = el('update');
  clearTimeout(noteTimer);
  offered = state.available;
  if (state.available && state.available !== laterFor) {
    el('updateText').textContent = `Version ${state.available} is out (you have ${state.current}).`;
    el('updateDownload').hidden = false;
    el('updateLater').hidden = false;
    box.hidden = false;
    return;
  }
  if (state.note) {
    // Only for a check someone asked for, and gone again after a few seconds.
    el('updateText').textContent =
      state.note === 'latest'
        ? `Tesserafy ${state.current} is the latest version.`
        : 'Could not check for updates. Try again later.';
    el('updateDownload').hidden = true;
    el('updateLater').hidden = true;
    box.hidden = false;
    noteTimer = setTimeout(() => {
      box.hidden = true;
    }, 5000);
    return;
  }
  box.hidden = true;
}

api.onUpdate(showUpdate);
void api.update().then(showUpdate);
el('updateDownload').addEventListener('click', () => void api.openUpdate());
el('updateLater').addEventListener('click', () => {
  laterFor = offered;
  el('update').hidden = true;
});

// The window is as tall as the card and no taller: the transparent part of a
// taller one looks like nothing and still takes the clicks meant for the
// meeting under it. Told on every change — signing in, a suggestion, the
// appearance panel — and the main process resizes to match.
const card = document.querySelector('.card');
new ResizeObserver(() => void api.fit(card.getBoundingClientRect().height)).observe(card);

el('quit').addEventListener('click', () => {
  if (listening) stopListening();
  void api.quit();
});

/*
 * Signed in or not.
 *
 * The page learns only who is signed in. Signing in hands the password to the
 * main process and forgets it; the token that comes back stays there.
 */
function showSignedIn(email) {
  signedIn = true;
  el('signin').hidden = true;
  el('who').hidden = false;
  el('whoEmail').textContent = email;
  el('password').value = '';
  el('signinError').textContent = '';
  el('assist').hidden = false;
  void loadSetup().then(() => loadCriteria());
}

/**
 * The prep's questions during the call, each struck through once the live
 * scorecard confirms the criterion it was asked for. A question is a
 * reminder, not a score: whether it was met is the scorecard's to say.
 */
function renderToAsk(card) {
  const section = el('toAsk');
  if (!listening || preparedQuestions.length === 0) {
    section.hidden = true;
    return;
  }
  const heading = document.createElement('h2');
  heading.textContent = 'To ask';
  const list = document.createElement('ol');
  for (const question of questionsToAsk(preparedQuestions, card.criteria)) {
    const li = document.createElement('li');
    li.textContent = question.ask;
    if (question.done) {
      li.className = 'done';
      li.title = `${question.label}: confirmed`;
    }
    list.append(li);
  }
  section.replaceChildren(heading, list);
  section.hidden = false;
}

function showSignedOut(remembers) {
  signedIn = false;
  agreed = false;
  el('agreement').hidden = true;
  el('listen').disabled = true;
  el('assist').hidden = true;
  el('nextCall').textContent = '';
  el('brief').hidden = true;
  el('toAsk').hidden = true;
  el('signin').hidden = false;
  el('who').hidden = true;
  el('listen').disabled = true;
  el('remembers').textContent = remembers
    ? 'You stay signed in on this computer until you sign out.'
    : 'This computer cannot store a sign-in securely, so you will be asked each time.';
  setStatus('sign in to connect');
}

el('signin').addEventListener('submit', async (event) => {
  event.preventDefault();
  el('signinButton').disabled = true;
  el('signinError').textContent = '';
  const result = await api.signIn(el('identifier').value, el('password').value);
  el('signinButton').disabled = false;
  if (result.ok) {
    showSignedIn(result.email);
  } else {
    el('password').value = '';
    el('signinError').textContent = result.message;
  }
});

el('signout').addEventListener('click', async () => {
  // A call in progress is not carried across accounts.
  if (listening) stopListening();
  await api.signOut();
  state = null;
  const session = await api.session();
  showSignedOut(session.remembers);
});

api.session().then((session) => {
  if (session.email) showSignedIn(session.email);
  else showSignedOut(session.remembers);
});
