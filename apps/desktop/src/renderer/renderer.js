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
        `<li><span>${criterion.label}</span><span class="state ${criterion.status}">${criterion.status}</span></li>`,
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
  const result = await api.detect({ criteria: prompts, window: utterances.slice(-WINDOW_SIZE) });
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
  if (!config.token) {
    setStatus('set TESSERAFY_TOKEN to connect');
    return;
  }
  void loadCriteria();
});
