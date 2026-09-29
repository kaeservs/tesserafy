'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Write the brief again, from the prep as it stands now. One use of the allowance. */
export function RewriteBrief({ prepId, hasBrief }: { prepId: string; hasBrief: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/preps/${prepId}/brief`, { method: 'POST' });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'The brief could not be written.');
    } else {
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <p>
      <button type="button" onClick={() => void run()} disabled={busy}>
        {busy ? 'Writing the brief…' : hasBrief ? 'Write the brief again' : 'Write the brief'}
      </button>
      {error ? <span role="alert"> {error}</span> : null}
    </p>
  );
}
