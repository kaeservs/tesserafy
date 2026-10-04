'use client';

import { useActionState } from 'react';
import { savePrice, saveWebhookSecret, type PaymentsState } from './actions';

const START: PaymentsState = { status: 'idle' };

function Said({ state }: { state: PaymentsState }) {
  if (state.status === 'saved') return <p role="status">{state.message}</p>;
  if (state.status === 'error') return <p className="tag open">{state.message}</p>;
  return null;
}

export function WebhookSecretForm({ hint }: { hint: string | null }) {
  const [state, save, saving] = useActionState(saveWebhookSecret, START);
  return (
    <form action={save}>
      <label htmlFor="secret">Signing secret {hint ? `(now ending …${hint})` : ''}</label>{' '}
      <input id="secret" name="secret" type="password" autoComplete="off" required placeholder="whsec_…" />{' '}
      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : hint ? 'Replace' : 'Save'}
      </button>
      <Said state={state} />
    </form>
  );
}

export function PriceForm({ plan, name, price }: { plan: string; name: string; price: string | null }) {
  const [state, save, saving] = useActionState(savePrice, START);
  return (
    <form action={save}>
      <input type="hidden" name="plan" value={plan} />
      <label htmlFor={`price-${plan}`}>{name}</label>{' '}
      <input id={`price-${plan}`} name="price" defaultValue={price ?? ''} placeholder="price_…" autoComplete="off" />{' '}
      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <Said state={state} />
    </form>
  );
}
