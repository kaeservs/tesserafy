import Anthropic from '@anthropic-ai/sdk';
import { awaitableDatabaseSink, prepareBrief, T3_PREP_DETECTOR, type PrepBrief, type PrepPoint } from '@tesserafy/ai';
import { research, researchAvailable, type Research } from './apify';
import { fetchCriteria, type SupabaseClient } from '@tesserafy/db';
import { customerCoverage } from './account-story';
import { accountBrief } from './accounts';
import { loadGuidance, purposeOf } from './guidance';

/**
 * Writing a call prep's brief, as the person who asked: their RLS client reads
 * the prep, the customer's story and the scorecard, and their usage is what
 * is recorded. The route around this charges and refunds; this only reads,
 * asks and stores.
 */

export interface PrepRow {
  readonly id: string;
  readonly company_id: string;
  readonly account_id: string | null;
  readonly person_name: string;
  readonly person_title: string | null;
  readonly linkedin_url: string | null;
  readonly profile_text: string | null;
  readonly engagement_type: string;
  readonly call_at: string | null;
  readonly brief: unknown;
  readonly brief_model: string | null;
  readonly brief_at: string | null;
  readonly created_by: string | null;
  readonly created_at: string;
  readonly research: unknown;
  readonly research_at: string | null;
}

export const PREP_COLUMNS =
  'id, company_id, account_id, person_name, person_title, linkedin_url, profile_text, engagement_type, call_at, brief, brief_model, brief_at, created_by, created_at, research, research_at';

/** Points from briefs written before sources: all from the pasted profile. */
function readPoints(value: unknown): PrepPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = item as Partial<PrepPoint> | null;
    if (!record || typeof record.point !== 'string' || typeof record.quote !== 'string') return [];
    return [{ point: record.point, quote: record.quote, source: record.source ?? { id: 'profile' as const } }];
  });
}

/** Stored research, read defensively. */
export function readResearch(value: unknown): Research | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<Research>;
  return Array.isArray(record.sources)
    ? { linkedinUrl: record.linkedinUrl ?? null, company: record.company ?? null, sources: record.sources }
    : null;
}

/** A stored brief, read defensively: it is JSON from a column, not a type. */
export function readBrief(value: unknown): PrepBrief | null {
  if (!value || typeof value !== 'object') return null;
  const brief = value as Partial<PrepBrief>;
  if (!Array.isArray(brief.about) || !Array.isArray(brief.questions)) return null;
  return {
    about: readPoints(brief.about),
    company: readPoints(brief.company),
    questions: brief.questions,
    openWith: typeof brief.openWith === 'string' ? brief.openWith : null,
  };
}

/**
 * Whether this person may rewrite this prep's brief: its author, or an owner
 * of its company (private.may_change_prep). Asked before anything is spent —
 * the database refuses the write anyway, but only after the model and the web
 * research have run and been paid for.
 */
export async function mayChangePrep(db: SupabaseClient, userId: string, prepId: string): Promise<'ok' | 'not_found' | 'forbidden'> {
  const { data: prep } = await db.from('call_preps').select('company_id, created_by').eq('id', prepId).maybeSingle();
  if (!prep) return 'not_found';
  if (prep.created_by === userId) return 'ok';
  const { data: member } = await db
    .from('company_members')
    .select('role')
    .eq('company_id', prep.company_id)
    .eq('user_id', userId)
    .maybeSingle();
  return member?.role === 'owner' ? 'ok' : 'forbidden';
}

export type WriteOutcome = { status: 'written'; brief: PrepBrief; researchErrors: readonly string[] } | { status: 'not_found' };

/**
 * `withResearch`: look them up on the web first (lib/apify), when the
 * platform has an Apify token. Research is kept on the prep and reused while
 * the LinkedIn URL and the company are unchanged: Apify charges per run, and
 * a person does not change between two rewrites of one brief.
 */
export async function writePrepBrief(
  db: SupabaseClient,
  prepId: string,
  client: Anthropic = new Anthropic(),
  withResearch = false,
): Promise<WriteOutcome> {
  const { data: prep } = await db.from('call_preps').select(PREP_COLUMNS).eq('id', prepId).maybeSingle<PrepRow>();
  if (!prep) return { status: 'not_found' };

  const [criteria, story] = await Promise.all([
    fetchCriteria(db, prep.company_id, prep.engagement_type),
    prep.account_id ? accountBrief(db, prep.account_id) : Promise.resolve(null),
  ]);
  const coverage = story ? customerCoverage(story.calls).find((set) => set.engagementType === prep.engagement_type) : undefined;
  const established = coverage?.established.map(({ key, label }) => ({ key, label })) ?? [];
  const done = new Set(established.map((criterion) => criterion.key));
  const purpose = await purposeOf(db, prep.company_id, prep.engagement_type);

  let found = readResearch(prep.research);
  let researchErrors: readonly string[] = [];
  const company = story?.account.name ?? null;
  if (withResearch && researchAvailable() && (prep.linkedin_url || company)) {
    const stale = !found || found.linkedinUrl !== prep.linkedin_url || (company !== null && found.company !== company);
    if (stale) {
      const fresh = await research({ linkedinUrl: prep.linkedin_url, company, purpose });
      researchErrors = fresh.errors;
      found = { linkedinUrl: fresh.linkedinUrl, company: fresh.company, sources: fresh.sources };
      const { error: kept } = await db.rpc('set_call_prep_research', {
        p_prep_id: prep.id,
        p_research: { linkedinUrl: found.linkedinUrl, company: found.company, sources: found.sources.map((source) => ({ ...source })) },
      });
      if (kept) throw new Error(`Storing the research failed: ${kept.message}`);
    }
  }

  const usage = awaitableDatabaseSink({ db, companyId: prep.company_id, detector: T3_PREP_DETECTOR });
  const result = await prepareBrief(
    {
      person: { name: prep.person_name, title: prep.person_title },
      profileText: prep.profile_text,
      customer: story?.account.name ?? null,
      scorecard: prep.engagement_type,
      criteria: criteria.map((row) => ({ key: row.key, label: row.label, definition: row.definition })),
      established,
      // With no earlier calls, every criterion is still to find out.
      stillToFindOut: criteria.filter((row) => !done.has(row.key)).map((row) => ({ key: row.key, label: row.label })),
      earlier: (story?.signals ?? []).slice(0, 15).map((signal) => ({ kind: signal.kind, summary: signal.summary, quote: signal.quote })),
      ...(found && withResearch ? { sources: found.sources } : {}),
    },
    {
      client,
      onUsage: usage.sink,
      guidance: await loadGuidance(db, prep.company_id, 'prep', prep.engagement_type, purpose),
    },
  );
  await usage.settled();

  const brief: PrepBrief = { about: result.about, company: result.company, questions: result.questions, openWith: result.openWith };
  const plain = (points: readonly PrepPoint[]) => points.map((item) => ({ point: item.point, quote: item.quote, source: { ...item.source } }));
  const { error } = await db.rpc('set_call_prep_brief', {
    p_prep_id: prep.id,
    // Plain arrays, as JSON: the brief's own are read-only.
    p_brief: {
      about: plain(brief.about),
      company: plain(brief.company),
      questions: brief.questions.map((q) => ({ criterionKey: q.criterionKey, ask: q.ask, why: q.why })),
      openWith: brief.openWith,
      detector: result.detector,
      dropped: result.dropped,
    },
    p_model: result.model,
  });
  if (error) throw new Error(`Storing the brief failed: ${error.message}`);
  return { status: 'written', brief, researchErrors };
}

const HOUR = 3_600_000;

/**
 * Which prep the overlay shows for a customer: the one for the call nearest
 * now — from twelve hours ago to a week ahead, the call being joined — or,
 * with none in that window, the newest written. Only preps with a brief.
 */
export function pickPrep<T extends { call_at: string | null; created_at: string; brief: unknown }>(preps: readonly T[], now: Date): T | null {
  const written = preps.filter((prep) => prep.brief !== null);
  const soon = written
    .filter((prep) => prep.call_at !== null)
    .map((prep) => ({ prep, delta: Date.parse(prep.call_at!) - now.getTime() }))
    .filter(({ delta }) => delta >= -12 * HOUR && delta <= 7 * 24 * HOUR)
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  if (soon[0]) return soon[0].prep;
  return [...written].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}
