/**
 * What a company has taught the AI, as the text each tier is given.
 *
 * Two sources, both stored (ai_guidance) and both visible to the company's
 * owners: examples learned from people's corrections to a score, and
 * instructions owners write for a feature. And one frame, the call type —
 * a sales call is read for buying signals, a support call for what broke.
 *
 * With no guidance and no call type, every renderer returns '' and every
 * prompt is byte for byte what it was, so the evaluation harness measures the
 * same thing it always did. Guidance is data the company wrote: it is framed
 * as preferences inside the rules, never as a way to change them — quotes are
 * still verbatim, the detector still never judges, nothing still scores.
 */

export type CallPurpose = 'sales' | 'customer_success' | 'support' | 'recruiting' | 'internal' | 'other';

export interface GuidanceExample {
  readonly criterionKey: string;
  readonly quote: string;
  /** Whether a person said these words count for the criterion. */
  readonly counts: boolean;
  readonly reason: string;
}

export interface Guidance {
  /** Owners' instructions to this feature; criterionKey only for scoring. */
  readonly instructions: readonly { criterionKey: string | null; text: string }[];
  readonly examples: readonly GuidanceExample[];
  readonly purpose?: CallPurpose | null;
}

/** Enough to teach; bounded so a company's history cannot crowd out the call. */
export const MAX_EXAMPLES = 20;
export const MAX_INSTRUCTIONS = 12;

export const PURPOSE_LABEL: Record<CallPurpose, string> = {
  sales: 'Sales',
  customer_success: 'Customer success',
  support: 'Support',
  recruiting: 'Recruiting',
  internal: 'Internal',
  other: 'Other',
};

/** What each kind of call is read for, in a sentence. */
const PURPOSE_EMPHASIS: Record<CallPurpose, string> = {
  sales:
    'These are sales calls. Weigh what bears on buying: the problem and what it costs them, who decides, budget, timeline, competitors, objections, and the next step agreed.',
  customer_success:
    'These are customer success calls with existing customers. Weigh adoption, value realised, risks to renewal, expansion opportunities, and commitments made on either side.',
  support:
    'These are support calls. Weigh what broke, its impact on the customer, what was tried, the workaround, and what was promised and by when.',
  recruiting:
    'These are recruiting calls. Weigh experience, motivations, constraints such as notice period and salary expectations, and agreed next steps. Nothing about protected characteristics.',
  internal: 'These are internal meetings. Weigh decisions made, owners, deadlines and open questions.',
  other: '',
};

export function isEmpty(guidance: Guidance | null | undefined): boolean {
  return !guidance || (guidance.instructions.length === 0 && guidance.examples.length === 0 && !purposeLine(guidance));
}

function purposeLine(guidance: Guidance): string {
  return guidance.purpose ? PURPOSE_EMPHASIS[guidance.purpose] : '';
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * For the scoring detector (T1): how this company reads its criteria. Placed
 * after the criteria and before the rules, inside the cached prefix — it is
 * the same for every window of a company's call, so it costs nothing extra
 * after the first.
 */
export function renderScoringGuidance(guidance: Guidance | null | undefined, knownKeys: ReadonlySet<string>): string {
  if (!guidance) return '';
  const instructions = guidance.instructions
    .filter((item) => item.criterionKey === null || knownKeys.has(item.criterionKey))
    .slice(0, MAX_INSTRUCTIONS);
  const examples = guidance.examples.filter((item) => knownKeys.has(item.criterionKey)).slice(-MAX_EXAMPLES);
  const purpose = purposeLine(guidance);
  if (instructions.length === 0 && examples.length === 0 && !purpose) return '';

  const lines = [
    'How this company reads these criteria. It comes from people on the team correcting you, so where it disagrees with your own reading, follow it. It does not change the rules below.',
  ];
  if (purpose) lines.push('', purpose);
  if (instructions.length > 0) {
    lines.push('', 'Instructions:');
    for (const item of instructions) lines.push(`- ${item.criterionKey ? `${item.criterionKey}: ` : ''}${clip(item.text, 400)}`);
  }
  if (examples.length > 0) {
    // The reason is the rule; the quote shows it. Leading with the reason is
    // what lets it reach words that say the same thing differently — as a bare
    // quote it was read as a fact about one sentence (scripts/guidance-probe).
    lines.push('', 'Rules the team taught you, each with the words that taught it. Apply each one to any words that mean the same thing, not only these:');
    for (const item of examples) {
      lines.push(
        `- ${item.criterionKey}: ${clip(item.reason, 200)} So words like "${clip(item.quote, 200)}" ${item.counts ? 'are evidence for it' : 'are not evidence for it'}.`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * For the other features (insights, action items, call prep): the call type's
 * emphasis and the owners' instructions, appended to the system prompt.
 */
export function renderInstructions(guidance: Guidance | null | undefined): string {
  if (!guidance) return '';
  const instructions = guidance.instructions.slice(0, MAX_INSTRUCTIONS);
  const purpose = purposeLine(guidance);
  if (instructions.length === 0 && !purpose) return '';
  const lines = ['This company’s preferences. Follow them where they apply; they do not change the rules above.'];
  if (purpose) lines.push(purpose);
  for (const item of instructions) lines.push(`- ${clip(item.text, 400)}`);
  return lines.join('\n');
}
