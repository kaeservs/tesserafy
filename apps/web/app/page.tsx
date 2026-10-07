import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EarlyAccessForm } from '@/components/early-access-form';
import { Icon, type IconName } from '@/components/icons';
import { CallDemo } from '@/components/landing/call-demo';
import { GlassScene, type GlassTile } from '@/components/landing/glass-scene';
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
  incognito: boolean;
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

/** True of the product today, each one enforced in code: never a made-up metric. */
const FACTS: readonly { figure: string; label: string }[] = [
  { figure: '0', label: 'bots join your meeting' },
  { figure: 'Every', label: 'point quotes what was said' },
  { figure: '1 press', label: 'for what to say next' },
];

/** The glass tiles over the hero's landscape: clustered at its edges, clear of the headline. */
const HERO_TILES: readonly GlassTile[] = [
  { x: 7, y: 62, w: 64, h: 64 },
  { x: 13, y: 70, w: 64, h: 64 },
  { x: 7, y: 78, w: 64, h: 64 },
  { x: 19, y: 79, w: 44, h: 44, r: 10 },
  { x: 47, y: 86, w: 40, h: 40, r: 10 },
  { x: 52, y: 80, w: 32, h: 32, r: 9 },
  { x: 86, y: 58, w: 72, h: 72 },
  { x: 92, y: 66, w: 72, h: 72 },
  { x: 86, y: 74, w: 72, h: 72 },
  { x: 80, y: 82, w: 52, h: 52, r: 12 },
];

/** The closing card, one wide pane of glass over the same landscape. */
const CTA_TILES: readonly GlassTile[] = [{ x: 50, y: 50, w: 760, h: 300, r: 28 }];

/** The hero art: the painted landscape and its loop, once generated; a drawn stand-in until then. */
const HERO_IMAGE = '/landing/hero-placeholder.jpg';
const HERO_VIDEO: string | undefined = undefined;

const FAQ: readonly { q: string; a: string }[] = [
  {
    q: 'Can anyone on the call see it?',
    a: 'No bot joins and nothing is announced. On Incognito the overlay is excluded from screen capture too, so it does not appear when you share your screen; on the other plans it shows in a share.',
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
  lines.push(plan.incognito ? 'Overlay hidden from screen sharing' : 'Overlay shows in a screen share');
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
      .select('id, name, price_usd_cents, trial_days, incognito, calls, extractions, pattern_runs, questions, live_minutes')
      .order('rank'),
  ]);
  const plans = (planRows ?? []) as Plan[];
  const free = plans.find((plan) => plan.id === 'free') ?? null;
  const onSale = plans.filter((plan) => plan.price_usd_cents !== null || plan.id === 'free');
  const start = open === true ? 'Start free' : 'Get early access';
  // While sign-up is closed (until email works), the same buttons take an address instead.
  const startHref = open === true ? '/signup' : '#early-access';

  return (
    <div className="landing">
      <header className="landing-nav glass">
        <Link href="/" className="brand">
          <Icon name="logo" size={24} />
          <span>Tesserafy</span>
        </Link>
        <div className="landing-actions">
          <Link href="/login">Sign in</Link>
          <Link href={startHref} className="button-primary">
            {start}
          </Link>
        </div>
      </header>

      <main className="landing-main">
        <GlassScene image={HERO_IMAGE} {...(HERO_VIDEO ? { video: HERO_VIDEO } : {})} tiles={HERO_TILES} className="hero">
          <section className="hero-copy" aria-labelledby="hero-heading">
            <h1 id="hero-heading">
              Know what to say next — <em>on every call.</em>
            </h1>
            <p className="hero-lede">
              Tesserafy sits quietly over Zoom, Teams and Google Meet. It scores the conversation as it happens, tells you
              what to say or ask, and drafts your follow-up when you hang up. Every point quotes what was actually said.
            </p>
            <div className="hero-actions">
              <Link href={startHref} className="button-primary">
                {start}
              </Link>
              <Link href="/login" className="button-secondary glass">
                Sign in
              </Link>
            </div>
          </section>
        </GlassScene>

        <ul className="facts" aria-label="What is always true">
          {FACTS.map((fact) => (
            <li key={fact.label} className="glass fact">
              <strong>{fact.figure}</strong>
              <span>{fact.label}</span>
            </li>
          ))}
        </ul>

        <section className="landing-section wash" aria-labelledby="demo-heading">
          <p className="eyebrow">On a call</p>
          <h2 id="demo-heading">It listens, and helps when you ask</h2>
          <CallDemo />
        </section>

        <section className="landing-section" aria-labelledby="features-heading">
          <p className="eyebrow">What it does</p>
          <h2 id="features-heading">Built for the call itself</h2>
          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="glass feature">
                <span className="feature-icon">
                  <Icon name={feature.icon} size={22} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        {onSale.length > 0 ? (
          <section className="landing-section wash" aria-labelledby="pricing-heading">
            <h2 id="pricing-heading">Pricing</h2>
            <p className="section-lede">
              {free ? 'Start on Free, one seat. ' : ''}Then a plan, per seat, by the month — every seat brings its own
              allowance. Cancel any time.
            </p>
            <div className="price-grid">
              {onSale.map((plan) => (
                <div key={plan.id} className={`glass price${plan.id === 'pro' ? ' featured' : ''}`}>
                  <h3>{plan.name}</h3>
                  <p className="price-figure">
                    {plan.price_usd_cents === null ? '$0' : `$${(plan.price_usd_cents / 100).toFixed(2)}`}
                    <span>{plan.price_usd_cents === null ? ' one seat' : ' a seat a month'}</span>
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

        <section className="landing-section" aria-labelledby="faq-heading">
          <p className="eyebrow">Questions</p>
          <h2 id="faq-heading">Before you ask</h2>
          <div className="faq">
            {FAQ.map((item) => (
              <details key={item.q} className="glass">
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {open === true ? null : (
          <section id="early-access" className="landing-section early" aria-labelledby="early-heading">
            <div>
              <p className="eyebrow">Early access</p>
              <h2 id="early-heading">Get early access</h2>
              <p className="section-lede">
                Tesserafy is opening to a few teams at a time. Leave your work email and we will tell you when there is a
                place for yours.
              </p>
            </div>
            <div className="glass early-card">
              <EarlyAccessForm />
            </div>
          </section>
        )}

        <GlassScene image={HERO_IMAGE} tiles={CTA_TILES} className="closing">
          <section className="closing-copy" aria-labelledby="cta-heading">
            <h2 id="cta-heading">Your next call, with a second brain beside it.</h2>
            <p>Free to start. Nothing joins the meeting.</p>
            <Link href={startHref} className="button-primary">
              {start}
            </Link>
          </section>
        </GlassScene>
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
