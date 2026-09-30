/**
 * The overlay: listen, detect, score.
 *
 * Scoring is @tesserafy/scoring — the same pure function the web app uses,
 * which is what invariant 5's no-runtime-dependencies rule buys. The overlay
 * cannot invent a score any more than the browser can.
 *
 * Transcription is the browser engine inside Electron, a stand-in until spike
 * S2 chooses a streaming transcriber that can run under our own terms. Audio
 * leaving the machine is why the README calls this an instrument, not a
 * product.
 *
 * The token is never here. Detection and criteria go through the main process,
 * so this page holds no credential — a renderer is a browser, and a browser is
 * where a credential gets read by something nobody wrote. Signing in passes a
 * password through once, to the main process, and keeps nothing.
 */
import { apply, defineCriteriaSet, initialState, score } from '@tesserafy/scoring';
import { questionsToAsk } from './to-ask';

const api = window.overlay;
const WINDOW_SIZE = 3;

let state = null;
let prompts = [];
const utterances = [];
let protection = true;
let clickThrough = false;
let listening = false;
// Whether the main process holds a session. Listen is offered only then.
let signedIn = false;
let recognition = null;
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

  el('scoreValue').textContent = String(Math.round(card.score));
  // Built as nodes, never as HTML: a label is whatever a company's owner
  // typed into their scorecard, and markup in it would run in this window.
  el('criteria').replaceChildren(
    ...card.criteria.map((criterion) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = criterion.label;
      item.append(label);
      // Numbers only, not the sentence the web app writes. Phrasing it here
      // too would be a second copy of the wording to keep in step, and there
      // is no room for a sentence in a 380px overlay anyway — what a seller
      // needs mid-call is "one more mention", which `1/2` says.
      const short = criterion.shortfall;
      if (short && short.segmentsNeeded > 1) {
        const hint = document.createElement('span');
        hint.className = 'hint';
        hint.textContent = `${short.segments}/${short.segmentsNeeded}`;
        item.append(hint);
      }
      const status = document.createElement('span');
      status.className = `state ${criterion.status}`;
      status.textContent = criterion.status;
      item.append(status);
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

/** The customer this call is with, if anyone said. Chosen per call, never remembered. */
let chosenAccount = null;
/** The prep's questions for this customer's call, each naming its criterion. */
let preparedQuestions = [];

async function loadAccounts() {
  const result = await api.accounts();
  const accounts = result.accounts ?? [];
  const select = el('account');
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Not said';
  select.replaceChildren(
    none,
    ...accounts.map((account) => {
      const option = document.createElement('option');
      option.value = account.id;
      option.textContent = account.name;
      return option;
    }),
  );
  chosenAccount = null;
  preparedQuestions = [];
  el('brief').hidden = true;
  el('toAsk').hidden = true;
  el('accountPick').hidden = accounts.length === 0;
}

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

el('account').addEventListener('change', () => {
  if (listening) return;
  chosenAccount = el('account').value || null;
  void showBrief(chosenAccount);
});

/** The scorecard chosen for the next call, by name. */
let chosenScorecard = null;

async function loadScorecards() {
  const result = await api.scorecards();
  const sets = result.sets ?? [];
  chosenScorecard = result.chosen ?? chosenScorecard;
  const select = el('scorecard');
  select.replaceChildren(
    ...sets.map((set) => {
      const option = document.createElement('option');
      option.value = set.engagementType;
      option.textContent = set.own ? set.label : `${set.label} (template)`;
      option.selected = set.engagementType === chosenScorecard;
      return option;
    }),
  );
  el('scorecardPick').hidden = sets.length < 2;
}

el('scorecard').addEventListener('change', async () => {
  if (listening) return;
  chosenScorecard = await api.setScorecard(el('scorecard').value);
  // Loaded again for the next call; nothing is running to disturb.
  state = null;
  void loadCriteria();
});

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
    // Only reachable with the box ticked; the server refuses without it, and
    // a refusal leaves the call running unsaved rather than stopping it.
    consent: el('consent').checked,
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
  const window_ = utterances.slice(-WINDOW_SIZE);
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

function startListening() {
  const Engine = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Engine) {
    setStatus('no speech recognition in this build');
    return;
  }

  recognition = new Engine();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-GB';
  sessionStart = performance.now();

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript.trim();
      if (!result.isFinal || text.length === 0) continue;

      const endedAt = performance.now();
      const utterance = {
        id: `u${utterances.length}`,
        speaker: 'customer',
        startMs: Math.round(endedAt - sessionStart),
        endMs: Math.round(endedAt - sessionStart),
        text,
      };
      utterances.push(utterance);

      // Alongside detection, not before it: saving an utterance must never
      // sit between somebody finishing a sentence and the score moving.
      appendSegment(utterance);
      void detect(endedAt);
    }
  };

  // 'no-speech' fires on any quiet stretch. Announcing it mid-call would be
  // worse than the silence it reports.
  recognition.onerror = (event) => {
    if (event.error !== 'no-speech') setStatus(`speech: ${event.error}`);
  };
  recognition.onend = () => {
    listening = false;
    el('listen').textContent = 'Listen';
    el('consent').disabled = false;
    el('scorecard').disabled = false;
    el('account').disabled = false;
  };

  recognition.start();
  listening = true;
  el('listen').textContent = 'Stop';
  el('scorecard').disabled = true;
  el('account').disabled = true;
  // The brief was for walking in; the scorecard is for the call, with the
  // prep's questions beside it.
  el('brief').hidden = true;
  render();
  // Fixed for the length of the call: unticking mid-call would not unrecord
  // what was already said.
  el('consent').disabled = true;
  setStatus('listening');

  // Not awaited. The first utterance can be detected before the conversation
  // exists; its write simply finds no session and is skipped.
  void startSession();
}

// Each call is a different set of people, so the box starts unticked and is
// never remembered.
el('consent').addEventListener('change', () => {
  el('listen').disabled = (!el('consent').checked || !signedIn) && !listening;
});

el('listen').addEventListener('click', () => {
  if (listening) {
    recognition?.stop();
    return;
  }
  if (!el('consent').checked || !signedIn) return;
  if (state) {
    startListening();
    return;
  }
  void loadCriteria().then((ready) => ready && startListening());
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
// ours — another app may own them (see src/main/shortcuts.ts).
let keys = { visible: null, clickThrough: null };
void api.config().then((config) => {
  keys = config.shortcuts;
  const say = (shortcut, does, would) =>
    shortcut.available ? `${shortcut.keys} ${does}` : `${shortcut.keys} would ${would}, but another app uses it`;
  el('shortcutsNote').textContent =
    `Keyboard, whichever window is in front: ` +
    `${say(keys.visible, 'shows or hides the overlay', 'show or hide the overlay')}; ` +
    `${say(keys.clickThrough, 'turns click-through on or off', 'turn click-through on or off')}.`;
});

function showSwitches(state) {
  protection = state.protection;
  clickThrough = state.clickThrough;
  el('protection').textContent = `Protection: ${protection ? 'on' : 'off'}`;
  el('unprotected').hidden = protection;
  el('clickthrough').textContent = clickThrough
    ? `Click-through: on — ${keys.clickThrough?.available ? `${keys.clickThrough.keys} or ` : ''}the Tesserafy icon in ${trayPlace} turns it off`
    : 'Click-through: off';
}
api.onState(showSwitches);

el('protection').addEventListener('click', async () => {
  showSwitches({ protection: await api.setProtection(!protection), clickThrough });
});

el('clickthrough').addEventListener('click', async () => {
  showSwitches({ protection, clickThrough: await api.setClickThrough(!clickThrough) });
});

/*
 * Appearance.
 *
 * Theme, accent and background are this page's CSS; size and position move
 * the window, which only the main process can do. Every change goes through
 * the main process either way, and what it sends back — checked, clamped and
 * saved — is what is shown, so the page never displays a look that was not
 * kept.
 */
function showAppearance(look) {
  const root = document.documentElement;
  root.dataset.theme = look.theme;
  root.dataset.accent = look.accent;
  root.style.setProperty('--alpha', String(look.opacity / 100));
  el('opacity').value = String(look.opacity);
  el('opacityValue').textContent = `${look.opacity}%`;

  const pressed = (attribute, value) => {
    for (const button of document.querySelectorAll(`[${attribute}]`)) {
      button.setAttribute('aria-pressed', String(button.getAttribute(attribute) === value));
    }
  };
  pressed('data-theme-choice', look.theme);
  pressed('data-accent-choice', look.accent);
  pressed('data-size-choice', look.size);
  // Dragged somewhere of its own: no corner is the answer.
  pressed('data-corner-choice', look.position.corner ?? '');
}

async function changeAppearance(change) {
  showAppearance(await api.setAppearance(change));
}

function openLook(open) {
  el('look').hidden = !open;
  document.body.classList.toggle('looking', open);
  el('lookOpen').setAttribute('aria-expanded', String(open));
  // Read afresh: a drag since the last look moved it off its corner.
  if (open) void api.appearance().then(showAppearance);
}

const choices = [
  ['data-theme-choice', 'theme'],
  ['data-accent-choice', 'accent'],
  ['data-size-choice', 'size'],
  ['data-corner-choice', 'corner'],
];
for (const [attribute, field] of choices) {
  for (const button of document.querySelectorAll(`[${attribute}]`)) {
    button.addEventListener('click', () => void changeAppearance({ [field]: button.getAttribute(attribute) }));
  }
}

// Shown while dragging, kept when let go: one save per choice, not per pixel.
el('opacity').addEventListener('input', () => {
  const value = Number(el('opacity').value);
  document.documentElement.style.setProperty('--alpha', String(value / 100));
  el('opacityValue').textContent = `${value}%`;
});
el('opacity').addEventListener('change', () => void changeAppearance({ opacity: Number(el('opacity').value) }));

el('lookOpen').addEventListener('click', () => openLook(el('look').hidden));
el('lookDone').addEventListener('click', () => openLook(false));
el('lookReset').addEventListener('click', async () => showAppearance(await api.resetAppearance()));

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
  if (listening) recognition?.stop();
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
  void loadScorecards().then(() => loadCriteria());
  void loadAccounts();
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
  el('scorecardPick').hidden = true;
  el('accountPick').hidden = true;
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
    el('listen').disabled = !el('consent').checked;
  } else {
    el('password').value = '';
    el('signinError').textContent = result.message;
  }
});

el('signout').addEventListener('click', async () => {
  // A call in progress is not carried across accounts.
  if (listening) recognition?.stop();
  await api.signOut();
  state = null;
  const session = await api.session();
  showSignedOut(session.remembers);
});

api.session().then((session) => {
  if (session.email) showSignedIn(session.email);
  else showSignedOut(session.remembers);
});
