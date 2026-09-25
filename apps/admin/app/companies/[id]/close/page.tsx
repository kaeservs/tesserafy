import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import { listCompanies } from '@/lib/companies';
import { utc } from '@/lib/time';
import { Chrome } from '../../../chrome';
import { CloseForm } from './form';

/**
 * Closing one company, on a page of its own.
 *
 * Not a button in the companies table: the action erases a customer's every
 * call, and a page that names the company, counts what will go and asks for
 * the name back is harder to reach by accident than a row's button is.
 */
export const dynamic = 'force-dynamic';

export default async function CloseCompany({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin();
  const { companies } = await listCompanies(admin.db);
  const company = companies.find((c) => c.companyId === id);
  if (!company) notFound();

  return (
    <Chrome email={admin.email}>
      <h1>Close {company.name}</h1>
      {/*
        One element either way, and the form always after it: closing
        refreshes this page, and a form that unmounted on the refresh took its
        result with it — including the tickets someone has to delete by hand.
      */}
      {company.closedAt ? (
        <div>
          <p className="lede">This company was closed on {utc(company.closedAt)}.</p>
        </div>
      ) : (
        <div>
          <p className="lede">
            Erases all {company.conversations} call{company.conversations === 1 ? '' : 's'} —
            transcripts, scores, signals, search index and insights — and removes all{' '}
            {company.members} {company.members === 1 ? 'person' : 'people'}. It cannot be undone.
          </p>
          <p className="muted">
            What stays: the company&apos;s name as a closed record, a content-free erasure record
            for each call, a record of each person removed, and the access and onboarding logs.
            Login accounts are kept, empty. Tickets already exported to a tracker are listed after
            closing, for you to delete there.
          </p>
        </div>
      )}
      <CloseForm companyId={company.companyId} name={company.name} closed={Boolean(company.closedAt)} />
    </Chrome>
  );
}
