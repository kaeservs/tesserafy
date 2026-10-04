import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EarlyAccessForm } from '@/components/early-access-form';
import { Icon, type IconName } from '@/components/icons';
import { createClient } from '@/lib/supabase/server';

/**
 * The front door: what Tesserafy is, for someone who has not signed in. A
 * signed-in person goes straight to Home, as before.
 *
 * Every claim here is one the product keeps and the code enforces: no bot
 * joins; the overlay is excluded from screen capture; every point quotes the
 * call or is dropped; the model never produces a score; calls are never used
 * for Tesserafy's own purposes; the person agrees once to tell everyone on
 * the calls they record. The prices and allowances are read from the plans
 * table, which is what the product charges against — never typed here.
 */

export const metadata: Metadata = {
  title: 'Tesserafy — know what to say next, on every call',
  description:
    'An assistant that sits over Zoom, Teams and Meet: a live scorecard, what to say next, and your follow-up drafted — every point quoting what was said.',
};

interface Plan {
  id: string;
  name: string;
  price_usd_cents: number | null;
  trial_days: number | null;
  calls: number | null;
  extractions: number | null;
  pattern_runs: number | null;
  questions: number | null;
  live_minutes: number | null;
}

const FEATURES: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'prepare',
    title: 'A scorecard that fills itself in',
    body: 'Pain, cost, timeline, who decides: each one ticks as the customer says it, linked to the words that earned it.',
  },
  {
    icon: 'ask',
    title: 'What to say next, in one press',
    body: 'Assist, What should I say?, Follow-up questions and Recap — grounded in what was just said, not in a script.',
  },
  {
    icon: 'insights',
    title: 'Answers from your own documents',
    body: 'Add your pricing and product sheets. Product answers come only from them, quoted and named. Nothing guessed.',
  },
  {
    icon: 'overlay',
    title: 'Ask about your screen',
    body: 'Press Screen and ask about the slide or dashboard in front of you. Sent for that answer only, never stored.',
  },
  {
    icon: 'calls',
    title: 'Your follow-up, drafted',
    body: 'When the call ends: the recap and the agreed next steps, each line resting on what was said. It promises nothing the call did not.',
  },
  {
    icon: 'search',
    title: 'Ask every past call',
    body: '“What did Northwind say about timing?” — answered from your calls, with a link to each moment.',
  },
];

const STEPS: readonly { title: string; body: string }[] = [
  { title: 'Before', body: 'Prepare the call: who it is with, what to open with, what to ask. The overlay brings it in.' },
  { title: 'During', body: 'The overlay sits over the meeting, scores as it goes and helps when you ask. Only you see it.' },
  { title: 'After', body: 'The follow-up email, action items and insights, each quoting the call — ready on your dashboard.' },
];

const FAQ: readonly { q: string; a: string }[] = [
  {
    q: 'Can anyone on the call see it?',
    a: 'No bot joins and nothing is announced. The overlay is excluded from screen capture, so it does not appear when you share your screen.',
  },
  {
    q: 'Do I have to tell people I am recording?',
    a: 'Yes. Telling everyone on the call, and recording only with their agreement, is your responsibility. You agree to that once, before your first recorded call, and every call records it.',
  },
  {
    q: 'Which meeting apps does it work with?',
    a: 'Any: it is a window over your screen, so Zoom, Microsoft Teams and Google Meet in a browser all work. On Windows it notices a call starting and offers to start.',
  },
  {
    q: 'Windows or Mac?',
    a: 'Windows today. Mac builds are available in early access.',
  },
  {
    q: 'What happens to my calls?',
    a: 'They are yours: kept for your company, never used for Tesserafy’s own purposes, and exportable or deletable at any time. Email addresses and phone numbers are masked before anything is stored.',
  },
];

function allowances(plan: Plan): string[] {
  const lines: string[] = [];
  const add = (n: number | null, one: string, many: string) => {
    if (n === null) lines.push(`Unlimited ${many}`);
    else if (n > 0) lines.push(`${n} ${n === 1 ? one : many}`);
  };
  add(plan.calls, 'imported call', 'imported calls');
  add(plan.live_minutes, 'live minute', 'live minutes');
  add(plan.questions, 'question to Ask', 'questions to Ask');
  add(plan.extractions, 'call read — insights, prep or follow-up', 'call reads — insights, prep, follow-ups');
  add(plan.pattern_runs, 'pattern run', 'pattern runs');
  return lines;
}

export default async function Landing() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/dashboard');

  const [{ data: open }, { data: planRows }] = await Promise.all([
    supabase.rpc('signup_is_open'),
    supabase
      .from('plans')
      .select('id, name, price_usd_cents, trial_days, calls, extractions, pattern_runs, questions, live_minutes')
      .order('rank'),
  ]);
  const plans = (planRows ?? []) as Plan[];
  const trial = plans.find((plan) => plan.id === 'trial') ?? null;
  const onSale = plans.filter((plan) => plan.price_usd_cents !== null);
  const start = open === true ? (trial?.trial_days ? `Start your ${trial.trial_days}-day trial` : 'Start your trial') : 'Get early access';
  // While sign-up is closed (until email works), the same buttons take an address instead.
  const startHref = open === true ? '/signup' : '#early-access';

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link href="/" className="brand">
          <Icon name="logo" size={26} />
          <span>Tesserafy</span>
        </Link>
        <nav aria-label="On this page" className="landing-links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          {onSale.length > 0 ? <a href="#pricing">Pricing</a> : null}
          <a href="#faq">Questions</a>
        </nav>
        <div className="landing-actions">
          <Link href="/login">Sign in</Link>
          <Link href={startHref} className="button-primary">
            {start}
          </Link>
        </div>
      </header>

      <main className="landing-main">
        <section className="hero" aria-labelledby="hero-heading">
          <div>
            <p className="eyebrow">For everyone who sells, onboards or supports on calls</p>
            <h1 id="hero-heading">Know what to say next — on every call.</h1>
            <p className="hero-lede">
              Tesserafy sits quietly over Zoom, Teams and Google Meet. It scores the conversation as it happens, tells you
              what to say or ask, and drafts your follow-up when you hang up. Every point quotes what was actually said.
            </p>
            <div className="hero-actions">
              <Link href={startHref} className="button-primary">
                {start}
              </Link>
              <Link href="/login" className="button-secondary">
                Sign in
              </Link>
            </div>
            <ul className="trust">
              <li>No bot joins your meeting</li>
              <li>Hidden from screen sharing</li>
              <li>Every point quotes the call</li>
            </ul>
          </div>

          {/* The overlay, drawn: what a seller sees mid-call. Illustrative, not a screenshot. */}
          <div className="mock" aria-label="The Tesserafy overlay during a call" role="img">
            <div className="mock-bar">
              <span className="mock-pill">Stop</span>
              <span className="mock-muted">Dana Whitfield · Northwind</span>
            </div>
            <div className="mock-score">
              <span className="mock-track">
                <span className="mock-fill" />
              </span>
              <strong>62</strong>
            </div>
            <div className="mock-chips">
              <span className="mock-chip on">Pain</span>
              <span className="mock-chip on">Cost</span>
              <span className="mock-chip on">Timeline</span>
              <span className="mock-chip">Budget</span>
            </div>
            <div className="mock-buttons">
              <span>Assist</span>
              <span>What should I say?</span>
              <span>Follow-ups</span>
              <span>Recap</span>
            </div>
            <div className="mock-answer">
              <p className="mock-title">What to say</p>
              <p>“So reconciling takes two days every month — what would getting those back be worth to your team?”</p>
              <p className="mock-quote">“Month-end reporting takes us two full days every month.”</p>
            </div>
          </div>
        </section>

        <section id="features" className="landing-section" aria-labelledby="features-heading">
          <h2 id="features-heading">Built for the call itself</h2>
          <p className="section-lede">Everything you need while it matters, and nothing you have to set up during the call.</p>
          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="card feature">
                <span className="stat-icon">
                  <Icon name={feature.icon} size={26} />
                </span>
                <h3>{feature.title}</h3>
                <p className="muted">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="landing-section" aria-labelledby="how-heading">
          <h2 id="how-heading">How it works</h2>
          <ol className="steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="card">
                <span className="step-number">{index + 1}</span>
                <h3>{step.title}</h3>
                <p className="muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section evidence" aria-labelledby="evidence-heading">
          <div>
            <h2 id="evidence-heading">Evidence, not guesses</h2>
            <p className="section-lede">
              The AI never hands you a number. It finds the words that show a point was covered, and the score is worked out
              from them. Anything it cannot trace back, word for word, to what was said is dropped before you see it.
            </p>
          </div>
          <div className="card evidence-card">
            <p className="muted" style={{ marginTop: 0 }}>
              Pain quantified <span className="pill pill-on">Confirmed</span>
            </p>
            <blockquote>“Most of Friday. Call it six hours each, so twelve hours a week between them.”</blockquote>
            <p className="muted" style={{ marginBottom: 0 }}>
              Tom Okafor · Harbor &amp; Pine discovery · 00:48
            </p>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="privacy-heading">
          <h2 id="privacy-heading">Private by design</h2>
          <ul className="privacy-list">
            <li>
              <strong>Nothing joins the meeting.</strong> No bot, no announcement, and the overlay is kept out of screen
              capture.
            </li>
            <li>
              <strong>Your calls stay yours.</strong> Never used for Tesserafy’s own purposes; export or delete any time.
            </li>
            <li>
              <strong>Contact details masked.</strong> Email addresses and phone numbers are removed before anything is
              stored.
            </li>
            <li>
              <strong>Consent stays with you.</strong> You agree once to tell everyone on the calls you record — the{' '}
              <Link href="/terms">Terms</Link> set out why.
            </li>
          </ul>
        </section>

        {onSale.length > 0 ? (
          <section id="pricing" className="landing-section" aria-labelledby="pricing-heading">
            <h2 id="pricing-heading">Pricing</h2>
            <p className="section-lede">
              {trial?.trial_days ? `${trial.trial_days} days free to start. ` : ''}Then a plan, by the month. Cancel any time.
            </p>
            <div className="price-grid">
              {onSale.map((plan) => (
                <div key={plan.id} className={`card price${plan.id === 'pro' ? ' featured' : ''}`}>
                  <h3>{plan.name}</h3>
                  <p className="price-figure">
                    ${((plan.price_usd_cents ?? 0) / 100).toFixed(0)}
                    <span className="muted"> a month</span>
                  </p>
                  <ul>
                    {allowances(plan).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <Link href={startHref} className={plan.id === 'pro' ? 'button-primary' : 'button-secondary'}>
                    {start}
                  </Link>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section id="faq" className="landing-section" aria-labelledby="faq-heading">
          <h2 id="faq-heading">Questions</h2>
          <div className="faq">
            {FAQ.map((item) => (
              <details key={item.q} className="card">
                <summary>{item.q}</summary>
                <p className="muted">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {open === true ? null : (
          <section id="early-access" className="landing-section early" aria-labelledby="early-heading">
            <div>
              <h2 id="early-heading">Get early access</h2>
              <p className="section-lede">
                Tesserafy is opening to a few teams at a time. Leave your work email and we will tell you when there is a
                place for yours.
              </p>
            </div>
            <div className="card">
              <EarlyAccessForm />
            </div>
          </section>
        )}

        <section className="cta" aria-labelledby="cta-heading">
          <h2 id="cta-heading">Your next call, with a second brain beside it.</h2>
          <Link href={startHref} className="promo-button">
            {start}
          </Link>
        </section>
      </main>

      <footer className="landing-footer">
        <span>© {new Date().getUTCFullYear()} Tesserafy</span>
        <nav aria-label="Legal" className="landing-links">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </footer>
    </div>
  );
}
