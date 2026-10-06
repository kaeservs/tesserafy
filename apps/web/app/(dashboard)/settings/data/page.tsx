import { day, myMembership } from '@/lib/membership';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Data · Tesserafy' };

/**
 * The whole company's data as one file, for the owner: before a pilot ends,
 * or when someone asks what is held about them. A member is told who can.
 */
export default async function DataPage() {
  const supabase = await createClient();
  const { isOwner, companyId, company } = await myMembership(supabase);
  const { data: exports } = isOwner
    ? await supabase
        .from('company_exports')
        .select('email, conversations, requested_at')
        .eq('company_id', companyId)
        .order('requested_at', { ascending: false })
        .limit(5)
    : { data: [] };

  return (
    <section aria-labelledby="export-heading" className="card">
      <h2 id="export-heading" style={{ marginTop: 0 }}>
        Take a copy of your data
      </h2>
      <p className="muted">
        One JSON file with every call&apos;s transcript, the quoted evidence behind its score, the signals and insights read
        from it, and everything else your company made here: customers, action items, follow-up emails, call preps,
        coaching, AI guidance and your own scorecards. Also your team and the log of deleted calls. Each export is recorded
        here, with who took it.
      </p>
      {isOwner ? (
        <>
          {/* A form, not a link: a link can be followed from any other site
              with the owner's session, and each export is recorded. */}
          <form method="post" action="/api/export">
            <p>
              <button type="submit" className="link-button">
                Download everything
              </button>
            </p>
          </form>
          {(exports ?? []).length > 0 ? (
            <ul className="muted" style={{ marginBottom: 0 }}>
              {(exports ?? []).map((row) => (
                <li key={row.requested_at}>
                  {row.email}, {day(row.requested_at)} — {row.conversations} call{row.conversations === 1 ? '' : 's'}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>
          Only an owner of {company?.name ?? 'this company'} can take a copy.
        </p>
      )}
    </section>
  );
}
