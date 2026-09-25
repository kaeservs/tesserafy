import type { CriterionShortfall } from '@tesserafy/scoring';

/**
 * What a criterion is still waiting on, in a line.
 *
 * The scorecard said "candidate" and left the reader to guess what would
 * settle it. That is the one question somebody watching a live score actually
 * has, and the answer was only reachable by reading thresholds out of the
 * database.
 *
 * The numbers come from the scoring engine, not from here. Phrasing them is
 * this component's whole job — working out *whether* one more mention would
 * confirm anything is the engine's, and a second opinion about it here would
 * drift from the first.
 *
 * Two routes to confirmation, so both are named: another utterance mentioning
 * it, or a single clearer one. A reader who only hears "say it again" will
 * keep asking the same question a second time when a sharper answer to the
 * first would have done.
 */
export function Shortfall({ shortfall }: { shortfall: CriterionShortfall | null }) {
  if (!shortfall) return null;

  const { segments, segmentsNeeded, bestConfidence, confirmingConfidence } = shortfall;

  if (segments === 0) {
    // "No evidence", not "not mentioned". The engine discards a contradiction
    // below the confirm threshold as well as weak evidence, so a criterion
    // can read as unobserved after the customer addressed it and was not
    // believed firmly enough to count. Claiming nobody mentioned it would be
    // asserting something about the conversation that this does not know.
    return <span className="shortfall">no evidence yet</span>;
  }

  const remaining = Math.max(0, segmentsNeeded - segments);
  const heard = segments === 1 ? 'heard once' : `heard ${segments} times`;
  // Confidences are the engine's business; the reader needs the two routes
  // to confirmation, not the thresholds behind them.
  const clearer = bestConfidence !== null && bestConfidence < confirmingConfidence;

  return (
    <span className="shortfall">
      {remaining > 0
        ? `${heard} — ${remaining === 1 ? 'one more mention' : `${remaining} more mentions`}${clearer ? ', or one clear statement,' : ''} would confirm it`
        : clearer
          ? `${heard} — one clear statement would confirm it`
          : heard}
    </span>
  );
}
