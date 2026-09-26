import type { Week } from '@/lib/report';

/**
 * The weekly average score, as a line — plain SVG, no chart library.
 *
 * A week with no scored call is a gap, not a zero: the line breaks there
 * rather than diving to the floor and implying the team's calls got worse
 * when nobody made any. Each point says, on hover, which week, the average,
 * and how many calls it rests on — two calls and twenty calls should not
 * look equally certain, and the count is how a reader tells them apart.
 */
const W = 640;
const H = 220;
// Room on the right for the last week's date, which is centred on its point.
const PAD = { left: 36, right: 28, top: 12, bottom: 44 };

function label(start: string): string {
  return new Date(`${start}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function ScoreTrend({ weeks }: { weeks: Week[] }) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (weeks.length === 1 ? innerW / 2 : (i * innerW) / (weeks.length - 1));
  const y = (score: number) => PAD.top + innerH - (score / 100) * innerH;

  // Runs of consecutive weeks with an average, each drawn as its own line.
  const runs: { i: number; avg: number }[][] = [];
  let run: { i: number; avg: number }[] = [];
  weeks.forEach((w, i) => {
    if (w.average === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ i, avg: w.average });
    }
  });
  if (run.length) runs.push(run);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Average score by week" className="trend">
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="trend-grid" />
          <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="trend-axis">
            {v}
          </text>
        </g>
      ))}
      {runs.map((points) => (
        <polyline
          key={points[0]!.i}
          points={points.map((p) => `${x(p.i)},${y(p.avg)}`).join(' ')}
          className="trend-line"
        />
      ))}
      {weeks.map((w, i) =>
        w.average === null ? null : (
          <circle key={w.start} cx={x(i)} cy={y(w.average)} r={4} className="trend-point">
            <title>{`Week of ${label(w.start)}: ${Math.round(w.average)} across ${w.scored} scored call${w.scored === 1 ? '' : 's'}`}</title>
          </circle>
        ),
      )}
      {weeks.map((w, i) => (
        <g key={`l-${w.start}`}>
          {i % 2 === weeks.length % 2 || i === weeks.length - 1 ? (
            <text x={x(i)} y={H - 24} textAnchor="middle" className="trend-axis">
              {label(w.start)}
            </text>
          ) : null}
          <text x={x(i)} y={H - 8} textAnchor="middle" className="trend-count">
            {w.calls > 0 ? w.calls : ''}
          </text>
        </g>
      ))}
    </svg>
  );
}
