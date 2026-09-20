/**
 * The overlay's scorecard.
 *
 * It scores with @tesserafy/scoring — the same pure function the web app uses,
 * which is the reason that package is allowed no runtime dependencies. The
 * overlay cannot invent a score any more than the browser can.
 *
 * Detection is not wired to a microphone yet: spike S2 has not chosen a
 * streaming transcriber, and inventing one here would mean building the part
 * most likely to be thrown away. What this proves is the second half —
 * evidence arriving from T1 becomes a scorecard on screen, over a meeting,
 * without the meeting noticing.
 */
import { apply, initialState, score, defineCriteriaSet } from '@tesserafy/scoring';

const api = window.overlay;

// The same five criteria the database ships. Loading them from the API is
// P7 work proper; hard-coding them here keeps the spike about the window.
const CRITERIA = defineCriteriaSet({
  engagementType: 'discovery',
  version: 1,
  criteria: [
    { key: 'pain_quantified', label: 'Pain quantified', weight: 1 },
    { key: 'current_process_known', label: 'Current process', weight: 1 },
    { key: 'desired_outcome_stated', label: 'Desired outcome', weight: 1 },
    { key: 'timeline_stated', label: 'Timeline', weight: 1 },
    { key: 'budget_indicated', label: 'Budget', weight: 1 },
  ],
});

let state = initialState(CRITERIA);
let protection = true;
let clickThrough = false;

function render() {
  const card = score(state);
  const confirmed = card.criteria.filter((criterion) => criterion.status === 'confirmed').length;
  document.getElementById('scoreValue').textContent = String(Math.round(card.score));
  document.getElementById('status').textContent = `${confirmed} of ${card.criteria.length} confirmed`;
  document.getElementById('criteria').innerHTML = card.criteria
    .map(
      (criterion) =>
        `<li><span>${criterion.label}</span><span class="state ${criterion.status}">${criterion.status}</span></li>`,
    )
    .join('');
}

/** Fold one detector event in. Exposed so a driver can push events in. */
window.pushEvent = (event) => {
  state = apply(state, event);
  render();
};

document.getElementById('protection').addEventListener('click', async () => {
  protection = await api.setProtection(!protection);
  document.getElementById('protection').textContent = `Protection: ${protection ? 'on' : 'off'}`;
  document.getElementById('unprotected').hidden = protection;
});

document.getElementById('clickthrough').addEventListener('click', async () => {
  clickThrough = await api.setClickThrough(!clickThrough);
  const button = document.getElementById('clickthrough');
  button.textContent = `Click-through: ${clickThrough ? 'on (restart to undo)' : 'off'}`;
});

render();
