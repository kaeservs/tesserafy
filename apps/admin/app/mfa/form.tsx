'use client';

import { useActionState } from 'react';
import { startEnrolment, verifyCode, type MfaState } from './actions';

const START: MfaState = { status: 'idle' };

function CodeForm({
  factorId,
  action,
  pending,
  label,
}: {
  factorId: string;
  action: (formData: FormData) => void;
  pending: boolean;
  label: string;
}) {
  return (
    <form action={action} className="row" style={{ alignItems: 'end' }}>
      <input type="hidden" name="factorId" value={factorId} />
      <label>
        Code from your authenticator
        <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus />
      </label>
      <button type="submit" disabled={pending}>
        {label}
      </button>
    </form>
  );
}

/** Asking for the code, for an operator who already has an authenticator. */
export function VerifyForm({ factorId }: { factorId: string }) {
  const [state, verify, pending] = useActionState(verifyCode, START);
  return (
    <>
      <CodeForm factorId={factorId} action={verify} pending={pending} label="Continue" />
      {state.status === 'error' ? <p className="tag open">{state.message}</p> : null}
    </>
  );
}

/**
 * Setting one up: scan the code, then prove it works by entering a code from
 * it. Only a factor that has produced a correct code counts.
 */
export function EnrolForm() {
  const [started, start, starting] = useActionState(startEnrolment, START);
  const [checked, verify, verifying] = useActionState(verifyCode, START);
  // After a wrong code the check's state carries the QR forward; before any,
  // the enrolment's does.
  const shown = checked.status === 'error' && checked.factorId ? checked : started;
  const factorId = shown.status === 'enrolling' ? shown.factorId : shown.status === 'error' ? shown.factorId : undefined;

  if (!factorId || shown.status === 'idle') {
    return (
      <form action={start}>
        <button type="submit" disabled={starting}>
          {starting ? 'Starting…' : 'Set up an authenticator'}
        </button>
        {started.status === 'error' ? <p className="tag open">{started.message}</p> : null}
      </form>
    );
  }

  return (
    <div>
      <p>
        Scan this with an authenticator app — Google Authenticator, Microsoft Authenticator, 1Password, Authy —
        then enter the code it shows.
      </p>
      {shown.qr ? (
        // A data: URL from Supabase: a picture of the secret, fetched from nowhere.
        <img src={shown.qr} alt="QR code for your authenticator app" width={200} height={200} style={{ background: '#fff', padding: 8 }} />
      ) : null}
      {shown.secret ? (
        <p className="muted">
          Or type this key into the app: <code>{shown.secret}</code>
        </p>
      ) : null}
      <CodeForm factorId={factorId} action={verify} pending={verifying} label="Turn it on" />
      {checked.status === 'error' ? <p className="tag open">{checked.message}</p> : null}
    </div>
  );
}
