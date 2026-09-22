import type { Scorecard } from '@tesserafy/scoring';

/**
 * A scorecard compressed to something you can read down a column.
 *
 * One pip per criterion, in the set's own order, so the same criterion is
 * always in the same position and a reader learns the shape rather than
 * re-reading the labels. "Which of these calls never established budget"
 * becomes a question you answer by looking at the fourth pip.
 *
 * The pips are `aria-hidden` and the same facts are given as a sentence. A
 * row of coloured rectangles is not information to a screen reader, and
 * labelling each pip individually would read out five states per row for
 * twenty rows — technically complete and unusable.
 */
export function ScorecardStrip({ scorecard }: { scorecard: Scorecard }) {
  const confirmed = scorecard.criteria.filter((c) => c.status === 'confirmed');
  const partial = scorecard.criteria.filter((c) => c.status === 'candidate');
  const against = scorecard.criteria.filter((c) => c.status === 'contradicted');

  const sentence = [
    `${confirmed.length} of ${scorecard.criteria.length} criteria confirmed`,
    partial.length > 0 ? `${partial.length} partial` : null,
    against.length > 0 ? `${against.length} contradicted` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <>
      <span className="pips" aria-hidden="true">
        {scorecard.criteria.map((criterion) => (
          <span
            key={criterion.key}
            className={`pip pip-${criterion.status}`}
            /* A tooltip is a convenience for a mouse, never the only route to
               the fact — the sentence below carries it for everyone else. */
            title={`${criterion.label}: ${criterion.status}`}
          />
        ))}
      </span>
      <span className="visually-hidden">{sentence}</span>
    </>
  );
}
