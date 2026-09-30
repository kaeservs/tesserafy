import Link from 'next/link';
import { fetchCriteriaSets, fetchCriterionLabels } from '@tesserafy/db';
import { AddInstruction, CallTypeForm } from '@/components/guidance-forms';
import { engagementLabel, myCompanyId } from '@/lib/company';
import { defaultPurpose, FEATURE_LABEL, type Feature } from '@/lib/guidance';
import { createClient } from '@/lib/supabase/server';
import { changeGuidance } from './actions';

export const metadata = { title: 'AI guidance · Tesserafy' };

const PURPOSE_LABEL: Record<string, string> = {
  sales: 'Sales',
  customer_success: 'Customer success',
  support: 'Support',
  recruiting: 'Recruiting',
  internal: 'Internal',
  other: 'Other',
};

interface GuidanceRow {
  id: string;
  feature: Feature;
  engagement_type: string | null;
  criterion_key: string | null;
  kind: 'instruction' | 'example';
  body: string;
  quote: string | null;
  counts: boolean | null;
  source_event_id: string | null;
  result: string | null;
  conversation_id: string | null;
  prep_id: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

/**
 * Everything the AI is told about this company, in one place: what kind of
 * call each scorecard is for, what it learned from people correcting its
 * scores, and what owners have told each feature. Nothing it learns is
 * hidden: an owner can read every item here, switch it off, or delete it.
 */
export default async function GuidancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const companyId = await myCompanyId(supabase, user?.id);
  const [{ data: membership }, { data: rows }, { data: purposes }, { data: company }, sets, labels, { data: team }] = await Promise.all([
    supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
    supabase
      .from('ai_guidance')
      .select('id, feature, engagement_type, criterion_key, kind, body, quote, counts, source_event_id, result, conversation_id, prep_id, active, created_by, created_at')
      .eq('company_id', companyId ?? '')
      .order('created_at', { ascending: false })
      .limit(500)
      .returns<GuidanceRow[]>(),
    supabase.from('scorecard_purposes').select('engagement_type, purpose').eq('company_id', companyId ?? ''),
    supabase.from('companies').select('default_engagement_type').eq('id', companyId ?? '').maybeSingle(),
    fetchCriteriaSets(supabase, companyId),
    fetchCriterionLabels(supabase, companyId),
    supabase.rpc('company_team'),
  ]);
  const isOwner = membership?.role === 'owner';
  const types = [...new Set(sets.map((set) => set.engagementType))];
  const purposeOf = new Map((purposes ?? []).map((row) => [row.engagement_type, row.purpose]));
  const defaultType = company?.default_engagement_type ?? 'discovery';
  const labelOf = new Map(labels.map((label) => [`${label.engagementType}/${label.key}`, label.label]));
  const nameOf = new Map((team ?? []).map((person) => [person.user_id, person.is_you ? 'you' : person.email]));
  const all = rows ?? [];
  const examples = all.filter((row) => row.kind === 'example' && row.result === null);
  const rejected = all.filter((row) => row.kind === 'example' && row.result !== null);
  const instructions = all.filter((row) => row.kind === 'instruction');

  const controls = (row: GuidanceRow) =>
    isOwner ? (
      <span className="guidance-controls">
        <form action={changeGuidance} className="inline-form">
          <input type="hidden" name="guidanceId" value={row.id} />
          <input type="hidden" name="change" value={row.active ? 'off' : 'on'} />
          <button type="submit" className="link-button">
            {row.active ? 'Switch off' : 'Switch on'}
          </button>
        </form>
        {' · '}
        <form action={changeGuidance} className="inline-form">
          <input type="hidden" name="guidanceId" value={row.id} />
          <input type="hidden" name="change" value="delete" />
          <button type="submit" className="link-button">
            Delete
          </button>
        </form>
      </span>
    ) : null;
  const scope = (row: GuidanceRow) =>
    [row.engagement_type ? `${engagementLabel(row.engagement_type)} calls` : 'every call type', row.criterion_key && row.engagement_type ? labelOf.get(`${row.engagement_type}/${row.criterion_key}`) ?? row.criterion_key : row.criterion_key]
      .filter(Boolean)
      .join(' · ');

  return (
    <main>
      <h1>AI guidance</h1>
      <p className="muted">
        What the AI is told about your company. It learns from every <em>This score is wrong</em>: the words, whether they count,
        and why; and from every <em>Not right</em> on an action item, a signal or a call prep, with why. Owners can add instructions for each feature. It all applies to calls scored and read from then on; calls
        already scored keep their evidence. Nothing here changes how a score is worked out, only what evidence the AI looks for.
      </p>

      <section aria-labelledby="types-heading" className="card">
        <h2 id="types-heading" style={{ marginTop: 0 }}>
          Call types
        </h2>
        <p className="muted">
          What each scorecard is for. Every AI feature leans that way: a sales call is read for buying signals and its prep looks
          at their company&apos;s situation; a support call&apos;s action items are what was promised to fix.
        </p>
        {types.map((type) =>
          isOwner ? (
            <CallTypeForm
              key={type}
              engagementType={type}
              label={engagementLabel(type)}
              purpose={purposeOf.get(type) ?? defaultPurpose(type)}
              isDefault={type === defaultType}
            />
          ) : (
            <p key={type}>
              {engagementLabel(type)}: {PURPOSE_LABEL[purposeOf.get(type) ?? defaultPurpose(type)]}
              {type === defaultType ? <span className="muted"> · default for new imports</span> : null}
            </p>
          ),
        )}
      </section>

      <section aria-labelledby="learned-heading">
        <h2 id="learned-heading">Learned from corrections ({examples.filter((row) => row.active).length} in use)</h2>
        {examples.length === 0 ? (
          <p className="muted">
            Nothing yet. On any call, <em>This score is wrong</em> with a reason teaches the scoring AI what counts for your team.
          </p>
        ) : (
          <ul className="signals">
            {examples.map((row) => (
              <li key={row.id} className={`signal${row.active ? '' : ' muted'}`}>
                <div className="signal-kind muted">
                  {scope(row)} · {row.counts ? 'counts' : 'does not count'}
                  {row.active ? '' : ' · switched off'}
                </div>
                <div>“{row.quote}”</div>
                <p className="muted" style={{ margin: '0.25rem 0' }}>
                  {row.body} — {row.created_by ? (nameOf.get(row.created_by) ?? 'a former member') : 'a former member'},{' '}
                  {new Date(row.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
                </p>
                {controls(row)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="rejected-heading">
        <h2 id="rejected-heading">Marked not right ({rejected.filter((row) => row.active).length} in use)</h2>
        {rejected.length === 0 ? (
          <p className="muted">
            Nothing yet. <em>Not right</em> on an action item, a signal found in a call, or a point in a call prep removes it and
            teaches that feature why.
          </p>
        ) : (
          <ul className="signals">
            {rejected.map((row) => (
              <li key={row.id} className={`signal${row.active ? '' : ' muted'}`}>
                <div className="signal-kind muted">
                  {FEATURE_LABEL[row.feature]} · {scope(row)}
                  {row.active ? '' : ' · switched off'}
                </div>
                <div>
                  “{row.result}”{' '}
                  {row.conversation_id ? (
                    <Link href={`/conversations/${row.conversation_id}`} className="muted">
                      the call
                    </Link>
                  ) : row.prep_id ? (
                    <Link href={`/prep/${row.prep_id}`} className="muted">
                      the prep
                    </Link>
                  ) : null}
                </div>
                <p className="muted" style={{ margin: '0.25rem 0' }}>
                  Not right: {row.body} — {row.created_by ? (nameOf.get(row.created_by) ?? 'a former member') : 'a former member'},{' '}
                  {new Date(row.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
                </p>
                {controls(row)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="instructions-heading">
        <h2 id="instructions-heading">Instructions</h2>
        {(['scoring', 'insights', 'action_items', 'prep'] as const).map((feature) => {
          const mine = instructions.filter((row) => row.feature === feature);
          return (
            <div key={feature}>
              <h3>{FEATURE_LABEL[feature]}</h3>
              {mine.length === 0 ? (
                <p className="muted">None.</p>
              ) : (
                <ul className="evidence">
                  {mine.map((row) => (
                    <li key={row.id} className={row.active ? undefined : 'muted'}>
                      {row.body} <span className="muted">— {scope(row)}{row.active ? '' : ', switched off'}</span> {controls(row)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {isOwner ? (
          <AddInstruction
            scorecards={types.map((type) => ({ value: type, label: engagementLabel(type) }))}
            criteria={labels.map((label) => ({ engagementType: label.engagementType, key: label.key, label: label.label }))}
          />
        ) : (
          <p className="muted">Owners add instructions; you can read them here.</p>
        )}
      </section>

      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Where people correct the AI most is on each scorecard&apos;s page, under{' '}
        <Link href={`/scorecards/${encodeURIComponent(defaultType)}`}>Criterion health</Link>.
      </p>
    </main>
  );
}
