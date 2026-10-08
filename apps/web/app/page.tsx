import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Icon, type IconName } from '@/components/icons';
import { GlassScene, type GlassTile } from '@/components/landing/glass-scene';
import { HeroBirds } from '@/components/landing/hero-birds';
import { HeroMotion } from '@/components/landing/hero-motion';
import { HowItWorks } from '@/components/landing/how-it-works';
import { LandingNav, type LandingSection } from '@/components/landing/landing-nav';
import { OverlayDemo } from '@/components/landing/overlay-demo';
import { ScrollReveal } from '@/components/landing/scroll-reveal';
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

/**
 * True of the product today, each one enforced in code: never a made-up
 * metric. Undetectable means to the meeting — no bot, no announcement — on
 * every plan; kept out of a screen share too is Incognito's, and the FAQ says so.
 */
const FACTS: readonly { icon: IconName; figure: string; label: string }[] = [
  { icon: 'unseen', figure: 'Undetectable', label: 'No bot joins your meeting, and nothing announces it.' },
  { icon: 'live', figure: 'Live', label: 'The scorecard fills in while the customer is still talking.' },
  { icon: 'quote', figure: 'Grounded', label: 'Every point quotes what was said, or it is not shown.' },
];

/** The menu's links, one to each section of the page, in its order. */
const SECTIONS: readonly LandingSection[] = [
  { id: 'demo', label: 'Demo' },
  { id: 'features', label: 'Features' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'faq', label: 'FAQ' },
];

/** The closing card, one wide pane of glass over the same landscape. */
const CTA_TILES: readonly GlassTile[] = [{ x: 50, y: 50, w: 760, h: 300, r: 28 }];

/** Every button on the page: sign-up, which says plainly when it is not open yet. */
const START = 'Start free';
const START_HREF = '/signup';

const PRIVACY: readonly { title: string; body: string }[] = [
  { title: 'Nothing joins the meeting', body: 'No bot, no announcement. On Incognito the overlay is kept out of screen sharing too.' },
  { title: 'Your calls stay yours', body: 'Never used for Tesserafy’s own purposes. Export or delete them whenever you like.' },
  { title: 'Contact details masked', body: 'Email addresses and phone numbers are removed before anything is stored.' },
  { title: 'Consent stays with you', body: 'You agree once to tell everyone on the calls you record; every call keeps that record.' },
];

/**
 * The hero art: a painted landscape, generated in devmotion, in three widths
 * so a phone does not download the largest. A plain picture: the hero's
 * movement is CSS (the birds, and the picture drifting as the page scrolls).
 */
const HERO_IMAGE = '/landing/hero.webp';
const HERO_SRCSET = '/landing/hero-768.webp 768w, /landing/hero-1152.webp 1152w, /landing/hero.webp 1536w';

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
    a: 'Any: it is a window over your screen, so Zoom, Microsoft Teams and Google Meet in a browser all work. On Windows, and on a Mac with macOS 14.2 or later, it notices a call starting and offers to start.',
  },
  {
    q: 'Windows or Mac?',
    a: 'Both: there is an installer for Windows and one for each kind of Mac.',
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

  const { data: planRows } = await supabase
    .from('plans')
    .select('id, name, price_usd_cents, trial_days, incognito, calls, extractions, pattern_runs, questions, live_minutes')
    .order('rank');
  const plans = (planRows ?? []) as Plan[];
  const free = plans.find((plan) => plan.id === 'free') ?? null;
  const onSale = plans.filter((plan) => plan.price_usd_cents !== null || plan.id === 'free');

  return (
    <div className="landing">
      <ScrollReveal />
      <LandingNav
        sections={onSale.length > 0 ? SECTIONS : SECTIONS.filter((section) => section.id !== 'pricing')}
        start={{ href: START_HREF, label: START }}
      />

      <main>
        <section className="hero" aria-labelledby="hero-heading">
          <img
            className="hero-art"
            src={HERO_IMAGE}
            srcSet={HERO_SRCSET}
            sizes="100vw"
            width={1536}
            height={1024}
            alt=""
            fetchPriority="high"
          />
          <HeroBirds />
          <HeroMotion />
          <div className="hero-copy">
            <h1 id="hero-heading">
              Know what to say next — <em>on every call.</em>
            </h1>
            <p className="hero-lede">
              Tesserafy sits quietly over Zoom, Teams and Google Meet. It scores the conversation as it happens, tells you what
              to say or ask, and drafts your follow-up when you hang up. Every point quotes what was actually said.
            </p>
            <div className="hero-actions">
              <Link href={START_HREF} className="button-primary">
                {START}
              </Link>
              <a href="#demo" className="button-secondary">
                Try the demo
              </a>
            </div>
          </div>
          <a href="#demo" className="scroll-cue" aria-label="Scroll to the demo">
            <span aria-hidden="true" />
          </a>
        </section>

        <div className="landing-main">
          <ul className="facts" aria-label="What is always true">
            {FACTS.map((fact) => (
              <li key={fact.figure} className="glass fact">
                <span className="fact-icon">
                  <Icon name={fact.icon} size={20} />
                </span>
                <strong>{fact.figure}</strong>
                <span>{fact.label}</span>
              </li>
            ))}
          </ul>

          <section id="demo" className="landing-section wash" aria-labelledby="demo-heading" data-reveal>
            <p className="eyebrow">Try it</p>
            <h2 id="demo-heading">The overlay, on a sample call</h2>
            <p className="section-lede">
              Drag it anywhere over the meeting, change how it looks, and press its buttons — it answers from what has been
              said. A written sample, played in your browser: nothing is recorded or sent.
            </p>
            <OverlayDemo />
          </section>

          <section id="features" className="landing-section" aria-labelledby="features-heading" data-reveal>
            <p className="eyebrow">What it does</p>
            <h2 id="features-heading">Built for the call itself</h2>
            <div className="feature-grid">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="pane feature" data-reveal>
                  <span className="feature-icon">
                    <Icon name={feature.icon} size={22} />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <HowItWorks />

        <div className="landing-main">
          <section id="privacy" className="landing-section" aria-labelledby="privacy-heading" data-reveal>
            <p className="eyebrow">Private by design</p>
            <h2 id="privacy-heading">Yours, and only yours</h2>
            <ul className="privacy-grid">
              {PRIVACY.map((point) => (
                <li key={point.title} className="pane privacy-card" data-reveal>
                  <h3>{point.title}</h3>
                  <p>{point.body}</p>
                </li>
              ))}
            </ul>
          </section>

          {onSale.length > 0 ? (
            <section id="pricing" className="landing-section wash" aria-labelledby="pricing-heading" data-reveal>
              <h2 id="pricing-heading">Pricing</h2>
              <p className="section-lede">
                {free ? 'Start on Free, one seat. ' : ''}Then a plan, per seat, by the month — every seat brings its own
                allowance. Cancel any time.
              </p>
              <div className="price-grid">
                {onSale.map((plan) => (
                  <div key={plan.id} className={`pane price${plan.id === 'pro' ? ' featured' : ''}`}>
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
                    <Link href={START_HREF} className={plan.id === 'pro' ? 'button-primary' : 'button-secondary'}>
                      {START}
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section id="faq" className="landing-section" aria-labelledby="faq-heading" data-reveal>
            <p className="eyebrow">Questions</p>
            <h2 id="faq-heading">Before you ask</h2>
            <div className="faq">
              {FAQ.map((item) => (
                <details key={item.q} className="pane">
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        </div>

        <GlassScene image={HERO_IMAGE} tiles={CTA_TILES} className="closing">
          <section className="closing-copy" aria-labelledby="cta-heading">
            <h2 id="cta-heading">Your next call, with a second brain beside it.</h2>
            <p>Free to start. Nothing joins the meeting.</p>
            <Link href={START_HREF} className="button-primary">
              {START}
            </Link>
          </section>
        </GlassScene>
      </main>

      <footer className="landing-footer">
        <span>© {new Date().getUTCFullYear()} Tesserafy</span>
        <nav aria-label="Legal" className="landing-links">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </footer>
    </div>
  );
}
