import { Icon } from '@/components/icons';

/**
 * The product, on a call: a meeting window with the overlay floating over it,
 * playing a fourteen-second loop in CSS alone. Three things the customer says
 * scroll past as captions; after each, a criterion lights with the words that
 * earned it and the score climbs; then "What should I say?" answers with a
 * question that quotes the call. It is an illustration and says so — not a
 * screenshot and not a real customer — and it holds its last frame for anyone
 * who asked for reduced motion.
 */

const LINES = [
  'Month-end reporting takes us two full days every month.',
  'If we closed it in a day, that’s about eight thousand a month back.',
  'We’d want something live before the Q3 board review.',
] as const;

const CRITERIA = [
  { name: 'Pain', quote: '“two full days every month”' },
  { name: 'Cost', quote: '“about eight thousand a month”' },
  { name: 'Timeline', quote: '“before the Q3 board review”' },
  { name: 'Decision maker', quote: null },
] as const;

const SCORES = [24, 46, 63, 71] as const;

export function CallDemo() {
  return (
    <figure className="demo" aria-labelledby="demo-caption">
      <div className="demo-meeting" aria-hidden="true">
        <div className="demo-bar">
          <span className="demo-dots">
            <i />
            <i />
            <i />
          </span>
          <span>Northwind · Discovery call</span>
          <span className="demo-rec">● 04:12</span>
        </div>
        <div className="demo-people">
          <div className="demo-person speaking">
            <span className="demo-avatar">DW</span>
            <span className="demo-name">Dana Whitfield · Northwind</span>
          </div>
          <div className="demo-person">
            <span className="demo-avatar you">You</span>
            <span className="demo-name">You</span>
          </div>
        </div>
        <div className="demo-captions">
          {LINES.map((line, index) => (
            <p key={line} className={`demo-line demo-line-${index + 1}`}>
              <strong>Dana</strong> {line}
            </p>
          ))}
        </div>
        <div className="demo-controls">
          <span>Mute</span>
          <span>Video</span>
          <span>Share</span>
          <span className="leave">Leave</span>
        </div>
      </div>

      <div className="demo-overlay glass" aria-hidden="true">
        <div className="demo-overlay-head">
          <span className="demo-brand">
            <Icon name="logo" size={16} /> Listening
          </span>
          <span className="demo-score">
            {SCORES.map((score, index) => (
              <b key={score} className={`demo-score-${index + 1}`}>
                {score}
              </b>
            ))}
          </span>
        </div>
        <span className="demo-track">
          <span className="demo-fill" />
        </span>
        <ul className="demo-criteria">
          {CRITERIA.map((criterion, index) => (
            <li key={criterion.name} className={criterion.quote ? `demo-met demo-met-${index + 1}` : 'demo-open'}>
              <span className="demo-chip">{criterion.name}</span>
              {criterion.quote ? <span className="demo-quote">{criterion.quote}</span> : null}
            </li>
          ))}
        </ul>
        <div className="demo-buttons">
          <span>Assist</span>
          <span className="demo-press">What should I say?</span>
          <span>Recap</span>
        </div>
        <div className="demo-answer">
          <p className="demo-answer-title">What to say</p>
          <p>“Who else needs to see this before the Q3 review?”</p>
          <p className="demo-answer-why">Decision maker is still open · they said “before the Q3 board review”</p>
        </div>
      </div>

      <figcaption id="demo-caption" className="demo-caption">
        An illustration of Tesserafy on a discovery call: the scorecard fills as the customer speaks, each point with the
        words that earned it, and “What should I say?” asks about what is still open.
      </figcaption>
    </figure>
  );
}
