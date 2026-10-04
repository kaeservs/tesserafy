import { requireAdmin } from '@/lib/admin';
import { Chrome } from '../chrome';
import { PriceForm, WebhookSecretForm } from './forms';

/**
 * Payments (ADR 0025): what turns them on, and what Stripe has told us.
 *
 * Plans stay free until both are here: Stripe's signing secret for the
 * webhook, which the database checks every event with, and the Stripe price
 * each paid plan is sold at. The secret key for making checkouts is the web
 * app's (`STRIPE_SECRET_KEY` in its environment), not something set here.
 */
export const dynamic = 'force-dynamic';

interface Status {
  ready: boolean;
  webhook_secret_hint: string | null;
  webhook_secret_set_at: string | null;
  paying: number;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

export default async function Payments() {
  const admin = await requireAdmin();
  const [{ data: statusData, error }, { data: plans }, { data: events }, { data: changes }] = await Promise.all([
    admin.db.rpc('admin_payments_status'),
    admin.db.from('plans').select('id, name, price_usd_cents, stripe_price_id').eq('self_serve', true).order('rank'),
    admin.db.from('stripe_events').select('id, type, outcome, company_id, received_at').order('received_at', { ascending: false }).limit(25),
    admin.db.from('payment_setting_events').select('setting, detail, at').order('at', { ascending: false }).limit(10),
  ]);
  const status = statusData as unknown as Status | null;

  return (
    <Chrome email={admin.email}>
      <h1>Payments</h1>
      <p className="lede">
        Plans are free until payments are on. Then a paid plan starts at Stripe&apos;s checkout, and a paying company
        changes plan or cancels in Stripe&apos;s billing page. Stripe tells us what happened through a webhook whose
        events the database checks against the signing secret below. Nothing else can change a plan on Stripe&apos;s
        behalf.
      </p>
      {error ? <p className="tag open">{error.message}</p> : null}

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>
          {status?.ready ? <span className="tag">on</span> : <span className="tag open">off</span>} Payments
        </h2>
        <p>
          {status?.ready
            ? `${status.paying} ${status.paying === 1 ? 'company pays' : 'companies pay'} through Stripe.`
            : 'Off until the signing secret and both prices are set, and the web app has STRIPE_SECRET_KEY.'}
        </p>
        <ol className="muted">
          <li>
            In Stripe, make a product for each plan with a monthly price, and paste each price&apos;s id below.
          </li>
          <li>
            Add a webhook endpoint at <code>https://&lt;the web app&gt;/api/stripe/webhook</code> for{' '}
            <code>checkout.session.completed</code> and <code>customer.subscription.created</code>,{' '}
            <code>.updated</code> and <code>.deleted</code>, and paste its signing secret below.
          </li>
          <li>
            Turn on the customer portal (Settings → Billing → Customer portal) with plan switching between the two prices
            and cancelling at the period&apos;s end.
          </li>
          <li>
            Set <code>STRIPE_SECRET_KEY</code> in the web app&apos;s environment: a restricted key with write access to
            Checkout Sessions and the Customer portal.
          </li>
        </ol>
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Webhook signing secret</h2>
        <p className="muted">
          {status?.webhook_secret_set_at ? `Set ${when(status.webhook_secret_set_at)}. ` : 'Not set. '}
          It is kept in the database, which no API can read it from, and is never shown again.
        </p>
        <WebhookSecretForm hint={status?.webhook_secret_hint ?? null} />
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Prices</h2>
        {(plans ?? []).map((plan) => (
          <PriceForm key={plan.id} plan={plan.id} name={`${plan.name} ($${((plan.price_usd_cents ?? 0) / 100).toFixed(0)} a month)`} price={plan.stripe_price_id} />
        ))}
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>What Stripe has told us</h2>
        {(events ?? []).length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <table tabIndex={0}>
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>What it did</th>
                <th>Company</th>
              </tr>
            </thead>
            <tbody>
              {(events ?? []).map((event) => (
                <tr key={event.id}>
                  <td>{when(event.received_at)}</td>
                  <td>
                    <code>{event.type}</code>
                  </td>
                  <td>{event.outcome}</td>
                  <td>{event.company_id ? <a href={`/companies/${event.company_id}`}>open</a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Changes</h2>
        {(changes ?? []).length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul>
            {(changes ?? []).map((change, index) => (
              <li key={index}>
                {when(change.at)}: {change.setting === 'price' ? 'price' : 'signing secret'} {change.detail}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Chrome>
  );
}
