/**
 * What a call says in the CRM (ADR 0024): the score and what it rests on,
 * the action items, and the way back to the call. Every criterion that is met
 * carries the customer's own words, as everywhere else in the product — a
 * note claiming "budget confirmed" with nothing quoted would be the one place
 * a score went out without its evidence.
 *
 * HubSpot shows a note as HTML; everything from the call is escaped, because
 * it is words people said, not markup.
 */

export interface CallForNote {
  readonly title: string;
  /** When the call happened, already formatted for a reader. */
  readonly when: string;
  readonly scorecard: string;
  /** 0–100, rounded; null when nothing has been scored. */
  readonly score: number | null;
  readonly criteria: readonly { readonly label: string; readonly met: boolean; readonly quote: string | null }[];
  readonly actions: readonly { readonly action: string; readonly ours: boolean; readonly done: boolean }[];
  readonly url: string;
}

/** A call's action items are a handful; a note with more says where the rest are. */
const MOST_ACTIONS = 30;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function noteHtml(call: CallForNote): string {
  const parts = [`<p><strong>${escapeHtml(call.title)}</strong> · ${escapeHtml(call.when)}</p>`];
  if (call.score !== null) {
    parts.push(`<p>${escapeHtml(call.scorecard)} scorecard: <strong>${call.score}/100</strong></p>`);
    parts.push(
      `<ul>${call.criteria
        .map((criterion) =>
          criterion.met
            ? `<li>${escapeHtml(criterion.label)}: met${criterion.quote ? ` — “${escapeHtml(criterion.quote)}”` : ''}</li>`
            : `<li>${escapeHtml(criterion.label)}: not yet</li>`,
        )
        .join('')}</ul>`,
    );
  }
  if (call.actions.length > 0) {
    parts.push('<p><strong>Action items</strong></p>');
    parts.push(
      `<ul>${call.actions
        .slice(0, MOST_ACTIONS)
        .map((item) => `<li>${escapeHtml(item.action)} (${item.ours ? 'ours' : 'theirs'}${item.done ? ', done' : ''})</li>`)
        .join('')}</ul>`,
    );
    if (call.actions.length > MOST_ACTIONS) parts.push(`<p>And ${call.actions.length - MOST_ACTIONS} more in Tesserafy.</p>`);
  }
  parts.push(`<p><a href="${escapeHtml(call.url)}">Open the call in Tesserafy</a>: every point there quotes what was said.</p>`);
  return parts.join('');
}
