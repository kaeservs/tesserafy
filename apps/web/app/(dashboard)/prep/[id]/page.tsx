import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchCriteriaSets, fetchCriterionLabels } from '@tesserafy/db';
import { PrepForm } from '@/components/prep-form';
import { NotRight } from '@/components/not-right';
import { RewriteBrief } from '@/components/rewrite-brief';
import { customerCoverage } from '@/lib/account-story';
import { accountBrief } from '@/lib/accounts';
import { engagementLabel, myCompanyId } from '@/lib/company';
import { PREP_COLUMNS, readBrief, readResearch, type PrepRow } from '@/lib/prep';
import { researchAvailable } from '@/lib/apify';
import type { PrepPoint } from '@tesserafy/ai';
import { createClient } from '@/lib/supabase/server';
import { chooseNextCall } from '../../account/overlay-actions';
import { deletePrep, rejectPrepItem } from '../actions';

export const metadata = { title: 'Call prep · Tesserafy' };

const KIND_LABEL: Record<string, string> = { problem: 'Problem', feature_request: 'Asked for' };

/**
 * One call's prep, to read beforehand. The brief's points about the person
 * each quote their profile; its questions each name the criterion they are
 * after. Beneath it, straight from the customer's calls rather than from the
 * model: what is established, what is still to find out, and what they said.
 */
/** "Not right" on one item of the brief, for whoever may change it. */
function Reject({ prepId, section, index, text }: { prepId: string; section: 'about' | 'company' | 'questions'; index: number; text: string }) {
  return (
    <NotRight
      action={rejectPrepItem}
      fields={{ prepId, section, index: String(index), text }}
      about={`“${text}”`}
      placeholder={section === 'questions' ? 'Too blunt to open with.' : 'Not relevant to this call.'}
    />
  );
}

/**
 * A point with where it came from: the pasted profile, or a source's link —
 * only ever a web address. A brief is stored as its author's JSON, and a link
 * of any other scheme is not one this page will render.
 */
function Point({ item, reject }: { item: PrepPoint; reject: ReactNode }) {
  return (
    <li>
      {item.point} <span className="muted">— “{item.quote}”</span>
      {'url' in item.source && /^https?:\/\//i.test(item.source.url) ? (
        <>
          {' '}
          <a href={item.source.url} target="_blank" rel="noopener noreferrer" className="source-link">
            {item.source.title}
          </a>
        </>
      ) : null}{' '}
      {reject}
    </li>
  );
}

export default async function PrepDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ research?: string }>;
}) {
  const { id } = await params;
  const { research: researchNote } = await searchParams;
  const supabase = await createClient();
  const { data: prep } = await supabase.from('call_preps').select(PREP_COLUMNS).eq('id', id).maybeSingle<PrepRow>();
  if (!prep) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const companyId = await myCompanyId(supabase);
  const [{ data: membership }, { data: accounts }, story, sets, labels, { data: preferences }] = await Promise.all([
    supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
    supabase.from('accounts').select('id, name').order('name').limit(500),
    prep.account_id ? accountBrief(supabase, prep.account_id) : Promise.resolve(null),
    fetchCriteriaSets(supabase, companyId),
    fetchCriterionLabels(supabase, companyId),
    supabase.from('user_preferences').select('next_prep_id').eq('user_id', user?.id ?? '').maybeSingle(),
  ]);
  const isNextCall = preferences?.next_prep_id === prep.id;
  const mayChange = membership?.role === 'owner' || (user !== null && prep.created_by === user.id);
  const brief = readBrief(prep.brief);
  const coverage = story ? customerCoverage(story.calls).find((set) => set.engagementType === prep.engagement_type) : undefined;
  const labelOf = new Map(
    labels.filter((label) => label.engagementType === prep.engagement_type).map((label) => [label.key, label.label]),
  );
  const scorecards = [...new Set(sets.map((set) => set.engagementType))].map((type) => ({ value: type, label: engagementLabel(type) }));

  return (
    <main>
      <p>
        <Link href="/prep">← Prepare</Link>
      </p>
      <h1>
        {prep.person_name}
        {story ? <span className="muted">, {story.account.name}</span> : null}
      </h1>
      {/* The overlay takes its customer, scorecard and questions from this
          prep when it is the person's next call (lib/live-setup). */}
      <form action={chooseNextCall} className="next-call">
        <input type="hidden" name="back" value={`/prep/${prep.id}`} />
        {isNextCall ? (
          <>
            <span className="stage">Your next call in the overlay</span>{' '}
            <button type="submit" className="link-button">
              Clear
            </button>
          </>
        ) : (
          <>
            <input type="hidden" name="prepId" value={prep.id} />
            <button type="submit">Use for my next call</button>{' '}
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              The overlay opens with this customer, scorecard and questions.
            </span>
          </>
        )}
      </form>
      <p className="muted">
        {prep.person_title ? `${prep.person_title} · ` : ''}
        {prep.call_at
          ? new Date(prep.call_at).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
          : 'No time set'}
        {' · '}
        {engagementLabel(prep.engagement_type)}
        {prep.linkedin_url ? (
          <>
            {' · '}
            <a href={prep.linkedin_url} target="_blank" rel="noopener noreferrer">
              LinkedIn profile
            </a>
          </>
        ) : null}
        {story ? (
          <>
            {' · '}
            <Link href={`/accounts/${story.account.id}`}>Every call with {story.account.name}</Link>
          </>
        ) : null}
      </p>

      <section aria-labelledby="brief-heading" className="card">
        <h2 id="brief-heading" style={{ marginTop: 0 }}>
          Brief
        </h2>
        {!brief ? (
          <p className="muted">No brief yet.</p>
        ) : (
          <>
            {brief.openWith ? (
              <p>
                <strong>Open with:</strong> {brief.openWith}
              </p>
            ) : null}
            {brief.about.length > 0 ? (
              <>
                <h3>About them</h3>
                <ul className="evidence">
                  {brief.about.map((item, index) => (
                    <Point
                      key={`${index}-${item.point}`}
                      item={item}
                      reject={mayChange ? <Reject prepId={prep.id} section="about" index={index} text={item.point} /> : null}
                    />
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">
                Nothing about them yet: paste what their profile says below, and the brief will quote it.
              </p>
            )}
            {brief.company.length > 0 ? (
              <>
                <h3>About their company</h3>
                <ul className="evidence">
                  {brief.company.map((item, index) => (
                    <Point
                      key={`${index}-${item.point}`}
                      item={item}
                      reject={mayChange ? <Reject prepId={prep.id} section="company" index={index} text={item.point} /> : null}
                    />
                  ))}
                </ul>
              </>
            ) : null}
            <h3>What to ask</h3>
            <ol>
              {brief.questions.map((question, index) => (
                <li key={`${index}-${question.ask}`} style={{ marginBottom: '0.5rem' }}>
                  {question.ask}{' '}
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    — for {labelOf.get(question.criterionKey) ?? question.criterionKey.replace(/_/g, ' ')}: {question.why}
                  </span>{' '}
                  {mayChange ? <Reject prepId={prep.id} section="questions" index={index} text={question.ask} /> : null}
                </li>
              ))}
            </ol>
          </>
        )}
        {researchNote === 'partial' ? (
          <p className="muted" role="status">
            Part of the web research did not come back, so the brief used what did.
          </p>
        ) : null}
        {mayChange ? <RewriteBrief prepId={prep.id} hasBrief={brief !== null} research={researchAvailable()} /> : null}
        {readResearch(prep.research) ? (
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Looked up on the web{' '}
            {new Date(prep.research_at ?? prep.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}:{' '}
            {readResearch(prep.research)!.sources.length} source{readResearch(prep.research)!.sources.length === 1 ? '' : 's'}.
          </p>
        ) : null}
        <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>
          Written by a model from what you pasted and from earlier calls, and checked: a point it could not quote from their
          profile is left out. Questions are suggestions; the scorecard judges the call.
        </p>
      </section>

      {story ? (
        <section aria-labelledby="story-heading">
          <h2 id="story-heading">From earlier calls with {story.account.name}</h2>
          {coverage ? (
            <p>
              {coverage.stillToFindOut.length > 0 ? (
                <>
                  <strong>Still to find out:</strong> {coverage.stillToFindOut.map((c) => c.label).join(', ')}.{' '}
                </>
              ) : (
                <strong>Every criterion is established. </strong>
              )}
              {coverage.established.length > 0 ? (
                <span className="muted">Established: {coverage.established.map((c) => c.label).join(', ')}.</span>
              ) : null}
            </p>
          ) : (
            <p className="muted">No scored call with them yet on this scorecard.</p>
          )}
          {story.signals.length > 0 ? (
            <ul className="signals">
              {story.signals.slice(0, 6).map((signal) => (
                <li key={signal.id} className="signal">
                  <div className="signal-kind muted">{KIND_LABEL[signal.kind] ?? signal.kind}</div>
                  <div>{signal.summary}</div>
                  {signal.quote && signal.segmentId ? (
                    <ul className="evidence">
                      <li>
                        <Link href={`/conversations/${signal.conversationId}#segment-${signal.segmentId}`}>
                          “{signal.quote}” <span className="muted">— {signal.conversationTitle}</span>
                        </Link>
                      </li>
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {mayChange ? (
        <details className="card">
          <summary>Change this prep</summary>
          <PrepForm
            initial={{
              prepId: prep.id,
              name: prep.person_name,
              title: prep.person_title,
              linkedin: prep.linkedin_url,
              profile: prep.profile_text,
              accountId: prep.account_id,
              engagementType: prep.engagement_type,
              callAt: prep.call_at,
            }}
            accounts={accounts ?? []}
            scorecards={scorecards}
            researchReady={researchAvailable()}
          />
          <form action={deletePrep} style={{ marginTop: '1rem' }}>
            <input type="hidden" name="prepId" value={prep.id} />
            <button type="submit" className="danger">
              Delete this prep
            </button>
          </form>
        </details>
      ) : null}
    </main>
  );
}
