'use client';

import { useState } from 'react';

/**
 * A link to one moment in a call, for pasting to a teammate. It opens the call
 * scrolled to that line and highlighted — the same anchor a quote under a
 * signal links to. Anyone opening it still signs in and still needs to be in
 * the company: the link names a place, it grants nothing.
 */
export function CopyMomentLink({ conversationId, segmentId }: { conversationId: string; segmentId: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/conversations/${conversationId}#segment-${segmentId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (an insecure origin, a denied permission): put the link
      // in the address bar instead, where it can be copied by hand.
      window.location.hash = `segment-${segmentId}`;
    }
  }

  return (
    <button type="button" className="link-button moment-link" onClick={() => void copy()} aria-label="Copy a link to this moment">
      {copied ? 'Link copied' : 'Copy link'}
    </button>
  );
}
