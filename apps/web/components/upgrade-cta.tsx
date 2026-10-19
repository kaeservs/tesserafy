import Link from 'next/link';
import { dollars, startingPrice, type CatalogRow } from '@/lib/plan-catalog';

/**
 * Home's way up from a starting plan (Free, the old trial, none): one line
 * and the way to Settings → Membership, where the plans sit side by side with
 * their allowances and the buttons that start them. Home is not where plans
 * are compared, so it does not repeat them; the price it names is the
 * cheapest paid plan's, from the catalogue.
 */
export function UpgradeCta({ plans, isOwner }: { plans: readonly CatalogRow[]; isOwner: boolean }) {
  const from = startingPrice(plans);
  return (
    <section className="card upgrade-cta" aria-label="Upgrade">
      <p>
        <strong>Upgrade to keep going.</strong>{' '}
        {from !== null ? `Paid plans start at ${dollars(from)} a seat a month, and every` : 'Paid plans are per seat, and every'}{' '}
        seat brings its own allowance.
      </p>
      {isOwner ? (
        <Link href="/settings/membership" className="button-primary">
          See plans
        </Link>
      ) : (
        <span className="muted">Ask an owner to upgrade.</span>
      )}
    </section>
  );
}
