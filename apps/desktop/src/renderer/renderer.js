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
 * where a credential gets read by something nobody wrote.
 */
import { apply, defineCriteriaSet, initialState, score } from '@tesserafy/scoring';

const api = window.overlay;
const WINDOW_SIZE = 3;

let state = null;
let prompts = [];
const utterances = [];
let protection = true;
let clickThrough = false;
let listening = false;
let recognition = null;
let sessionStart = 0;
const latencies = [];
// Which suggestion request is the current one. Speech does not wait for the
// network, so two are often in flight, and without this the slower of them
// wins the screen — which is how a suggestion about something said a minute
// ago replaces one about the sentence just spoken.
let suggestSeq = 0;

const el = (id) => document.getElementById(id);
const setStatus = (text) => {
  el('status').textContent = text;
};

function render() {
  if (!state) return;
  const card = score(state);
  const confirmed = card.criteria.filter((criterion) => criterion.status === 'confirmed').length;

  el('scoreValue').textContent = String(Math.round(card.score));
  el('criteria').innerHTML = card.criteria
    .map(
      (criterion) =>
        `<li><span class="label">${criterion.label}</span><span class="state ${criterion.status}">${criterion.status}</span></li>`,
    )
    .join('');

  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  setStatus(`${confirmed}/${card.criteria.length} confirmed${p50 ? ` · ${p50} ms p50` : ''}`);
}

async function loadCriteria() {
  const result = await api.criteria();
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

  // Only after the score is on screen. A suggestion is allowed to be late;
  // a score is not.
  void suggest(window_);
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
      utterances.push({
        id: `u${utterances.length}`,
        speaker: 'customer',
        startMs: Math.round(endedAt - sessionStart),
        endMs: Math.round(endedAt - sessionStart),
        text,
      });
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
  };

  recognition.start();
  listening = true;
  el('listen').textContent = 'Stop';
  setStatus('listening');
}

el('listen').addEventListener('click', () => {
  if (listening) {
    recognition?.stop();
    return;
  }
  if (state) {
    startListening();
    return;
  }
  void loadCriteria().then((ready) => ready && startListening());
});

el('protection').addEventListener('click', async () => {
  protection = await api.setProtection(!protection);
  el('protection').textContent = `Protection: ${protection ? 'on' : 'off'}`;
  el('unprotected').hidden = protection;
});

el('clickthrough').addEventListener('click', async () => {
  clickThrough = await api.setClickThrough(!clickThrough);
  el('clickthrough').textContent = `Click-through: ${clickThrough ? 'on (restart to undo)' : 'off'}`;
});

api.config().then((config) => {
  // Presence, not the value. The renderer has never needed the token itself
  // and must not be given it — see overlay:config in the main process.
  if (!config.hasToken) {
    setStatus('set TESSERAFY_TOKEN to connect');
    return;
  }
  void loadCriteria();
});
