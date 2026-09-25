import { recordFailure } from '@tesserafy/ai';
import { readAll } from '@tesserafy/db';
import { NextResponse, type NextRequest } from 'next/server';
import {
  assembleExport,
  exportFilename,
  type ComputedScore,
  type ConversationRow,
  type CriterionEventRow,
  type ErasureRow,
  type InsightEvidenceRow,
  type InsightRow,
  type SegmentRow,
  type SignalEvidenceRow,
  type SignalRow,
} from '@/lib/export';
import { allowance, tooMany } from '@/lib/rate-limit';
import { scoreConversations } from '@/lib/scorecard';
import { caller } from '@/lib/supabase/caller';

/**
 * An owner's full copy of their company's data.
 *
 * Under the owner's own session and nothing else: RLS decides what can be
 * read, which is exactly their company, and this route never holds a key that
 * could read more (invariant 3). Recorded before a row is read — see the
 * company_exports migration — and a refusal to record is a refusal to export.
 *
 * Every read is paged (readAll). An export that stopped at a thousand
 * segments would be a file that looks complete and is not, which is worse
 * than an error for exactly the person who needs it to be complete.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const limit = await allowance(who.db, 'api/export');
  if (!limit.allowed) return tooMany('api/export', limit.retryAfterSeconds);

  const { data: exportId, error: refused } = await who.db.rpc('record_company_export');
  if (refused) {
    const status = refused.code === '42501' ? 403 : 502;
    if (status === 502) recordFailure(refused, { db: who.db, source: 'api/export' });
    return NextResponse.json(
      { error: status === 403 ? 'Only an owner can export the company\'s data.' : refused.message },
      { status },
    );
  }

  try {
    const db = who.db;
    const [
      { data: auth },
      company,
      team,
      conversations,
      segments,
      criterionEvents,
      signals,
      signalEvidence,
      insights,
      insightEvidence,
      erasures,
    ] = await Promise.all([
      db.auth.getUser(),
      db.from('companies').select('name').limit(1).single(),
      db.rpc('company_team'),
      readAll<ConversationRow>(
        (from, to) =>
          db
            .from('conversations')
            .select('id, title, occurred_at, created_at, engagement_type, criteria_version, consent_statement, consent_confirmed_at')
            .order('occurred_at', { ascending: true })
            .order('id')
            .range(from, to),
        'Exporting conversations',
      ),
      readAll<SegmentRow>(
        (from, to) =>
          db.from('segments').select('id, conversation_id, speaker, start_ms, end_ms, text').order('id').range(from, to),
        'Exporting transcripts',
      ),
      readAll<CriterionEventRow>(
        (from, to) =>
          db
            .from('criterion_events')
            .select('conversation_id, criterion_key, kind, confidence, segment_id, quote, detector, model, created_at')
            .order('id')
            .range(from, to),
        'Exporting criterion evidence',
      ),
      readAll<SignalRow>(
        (from, to) => db.from('signals').select('id, conversation_id, kind, summary, confidence').order('id').range(from, to),
        'Exporting signals',
      ),
      readAll<SignalEvidenceRow>(
        (from, to) => db.from('signal_evidence').select('signal_id, segment_id, quote').order('id').range(from, to),
        'Exporting signal evidence',
      ),
      readAll<InsightRow>(
        (from, to) =>
          db
            .from('insights')
            .select('id, title, summary, status, created_at, decided_at')
            .order('created_at')
            .order('id')
            .range(from, to),
        'Exporting insights',
      ),
      readAll<InsightEvidenceRow>(
        (from, to) => db.from('insight_evidence').select('insight_id, signal_id').order('id').range(from, to),
        'Exporting insight evidence',
      ),
      readAll<ErasureRow>(
        (from, to) =>
          db
            .from('erasure_events')
            .select('conversation_id, reason, created_at, segments_removed, signals_removed')
            .order('created_at')
            .order('id')
            .range(from, to),
        'Exporting the erasure log',
      ),
    ]);

    if (company.error) throw new Error(`Exporting the company failed: ${company.error.message}`);
    if (team.error) throw new Error(`Exporting the team failed: ${team.error.message}`);

    // Computed now, from the evidence, as every page computes them.
    const scored = await scoreConversations(db, conversations);
    const scores = new Map<string, ComputedScore>(
      [...scored].map(([id, result]) => [
        id,
        {
          score: result.scorecard.score,
          criteria: result.scorecard.criteria.map((c) => ({ key: c.key, label: c.label, status: c.status })),
        },
      ]),
    );

    const now = new Date();
    const body = assembleExport({
      exportId,
      exportedAt: now.toISOString(),
      exportedBy: auth.user?.email ?? 'unknown',
      companyName: company.data.name,
      team: (team.data ?? []).map((person) => ({
        email: person.email,
        role: person.role,
        joined_at: person.joined_at,
      })),
      conversations,
      segments,
      criterionEvents,
      signals,
      signalEvidence,
      insights,
      insightEvidence,
      erasures,
      scores,
    });

    return new NextResponse(JSON.stringify(body, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${exportFilename(company.data.name, now)}"`,
        // Every call the company holds. Not for any cache between here and
        // the owner's disk.
        'cache-control': 'no-store',
      },
    });
  } catch (cause) {
    recordFailure(cause, { db: who.db, source: 'api/export' });
    return NextResponse.json(
      { error: 'The export could not be completed. It has been reported; try again shortly.' },
      { status: 502 },
    );
  }
}
