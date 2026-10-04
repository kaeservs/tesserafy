import type { SupabaseClient } from '@tesserafy/db';
import { companyDefaultScorecard, myCompanyId } from './company';
import { transcriptionAvailable } from './transcription';
import { currentAgreement, RECORDING_AGREEMENT, type Agreement } from './consent';
import { PREP_COLUMNS, readBrief, type PrepRow } from './prep';

/**
 * What the overlay needs to start a call, decided in the dashboard rather
 * than on the overlay: which customer, which scorecard, which prep, and how
 * the overlay looks. The customer and scorecard come from a call prep — the
 * one the person marked as their next call, or else their own prep whose call
 * is nearest (from two hours ago to twelve hours ahead). Without either, no
 * customer and the company's default scorecard.
 */

const BEFORE_MS = 2 * 3_600_000;
const AHEAD_MS = 12 * 3_600_000;
/** A meeting is "next" from half an hour before it starts until it ends. */
export const MEETING_AHEAD_MS = 30 * 60_000;

export interface LiveSetup {
  readonly look: Record<string, unknown>;
  readonly engagementType: string;
  readonly account: { id: string; name: string } | null;
  readonly prep: { id: string; person: string; callAt: string | null; chosen: boolean } | null;
  /** Whether the company lets the overlay send a screenshot with a question. */
  readonly screen: boolean;
  /** Whether the overlay shows itself, offering Start, when a call starts. */
  readonly detectCalls: boolean;
  /** Who transcribes the call: Deepgram, both sides (ADR 0022), or null for the browser's, microphone only. */
  readonly transcription: 'deepgram' | null;
  /** The person's one-time recording agreement under the current Terms, or null: Start asks for it first. */
  readonly agreement: Agreement | null;
  /** The words of that agreement, for the overlay to show; the server keeps what is agreed to. */
  readonly agreementText: string;
  /**
   * The person's next meeting with someone outside, from their calendar: on
   * now, or starting within half an hour. With the prep made from it, if any
   * — which then is the call's prep unless another was chosen.
   */
  readonly meeting: { id: string; title: string; startsAt: string; prepId: string | null } | null;
}

/** Of a person's calendar meetings, the one on now or starting soonest within the window. */
export function nextMeeting<T extends { starts_at: string; ends_at: string }>(events: readonly T[], now: Date): T | null {
  return (
    events
      .filter((event) => Date.parse(event.ends_at) > now.getTime() && Date.parse(event.starts_at) - now.getTime() <= MEETING_AHEAD_MS)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0] ?? null
  );
}

/** Of a person's own preps, the one whose call is nearest now, within the window. */
export function nearestPrep<T extends { call_at: string | null }>(preps: readonly T[], now: Date): T | null {
  return (
    preps
      .filter((prep) => prep.call_at !== null)
      .map((prep) => ({ prep, delta: Date.parse(prep.call_at!) - now.getTime() }))
      .filter(({ delta }) => delta >= -BEFORE_MS && delta <= AHEAD_MS)
      .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0]?.prep ?? null
  );
}

export async function liveSetup(db: SupabaseClient, userId: string, now = new Date()): Promise<LiveSetup> {
  const companyId = await myCompanyId(db, userId);
  const { data: preferences } = await db
    .from('user_preferences')
    .select('overlay_look, next_prep_id, detect_calls')
    .eq('user_id', userId)
    .maybeSingle();

  const { data: events } = await db
    .from('calendar_events')
    .select('id, title, starts_at, ends_at, prep_id')
    .eq('user_id', userId)
    .gt('ends_at', now.toISOString())
    .lte('starts_at', new Date(now.getTime() + MEETING_AHEAD_MS).toISOString());
  const meeting = nextMeeting(events ?? [], now);

  let prep: PrepRow | null = null;
  let chosen = false;
  if (preferences?.next_prep_id && companyId) {
    const { data } = await db
      .from('call_preps')
      .select(PREP_COLUMNS)
      .eq('id', preferences.next_prep_id)
      .eq('company_id', companyId)
      .returns<PrepRow[]>()
      .maybeSingle();
    prep = data ?? null;
    chosen = prep !== null;
  }
  // The meeting about to happen is the call, when a prep was made from it.
  if (!prep && meeting?.prep_id && companyId) {
    const { data } = await db
      .from('call_preps')
      .select(PREP_COLUMNS)
      .eq('id', meeting.prep_id)
      .eq('company_id', companyId)
      .returns<PrepRow[]>()
      .maybeSingle();
    prep = data ?? null;
  }
  if (!prep && companyId) {
    const { data } = await db
      .from('call_preps')
      .select(PREP_COLUMNS)
      .eq('company_id', companyId)
      .eq('created_by', userId)
      .not('call_at', 'is', null)
      .returns<PrepRow[]>();
    prep = nearestPrep(data ?? [], now);
  }

  let account: LiveSetup['account'] = null;
  if (prep?.account_id) {
    const { data } = await db.from('accounts').select('id, name').eq('id', prep.account_id).maybeSingle();
    account = data ?? null;
  }
  const fallback = prep ? null : await companyDefaultScorecard(db, userId);
  const { data: company } = companyId
    ? await db.from('companies').select('screen_assist').eq('id', companyId).maybeSingle()
    : { data: null };
  const look = preferences?.overlay_look;
  return {
    look: look && typeof look === 'object' && !Array.isArray(look) ? look : {},
    engagementType: prep?.engagement_type ?? fallback?.engagementType ?? 'discovery',
    account,
    prep: prep ? { id: prep.id, person: prep.person_name, callAt: prep.call_at, chosen } : null,
    screen: company?.screen_assist ?? false,
    detectCalls: preferences?.detect_calls ?? true,
    transcription: transcriptionAvailable() ? 'deepgram' : null,
    agreement: await currentAgreement(db, userId),
    agreementText: RECORDING_AGREEMENT,
    meeting: meeting ? { id: meeting.id, title: meeting.title, startsAt: meeting.starts_at, prepId: meeting.prep_id } : null,
  };
}

/** A prep's brief as plain text for the overlay's help: who, what to open with, what to ask. */
export function briefText(prep: PrepRow, accountName: string | null): string {
  const brief = readBrief(prep.brief);
  const lines = [`Call with ${prep.person_name}${prep.person_title ? `, ${prep.person_title}` : ''}${accountName ? ` at ${accountName}` : ''}.`];
  if (brief) {
    for (const item of [...brief.about, ...brief.company].slice(0, 6)) lines.push(`- ${item.point}`);
    if (brief.openWith) lines.push(`Open with: ${brief.openWith}`);
    for (const question of brief.questions.slice(0, 5)) lines.push(`To ask: ${question.ask}`);
  }
  return lines.join('\n');
}
