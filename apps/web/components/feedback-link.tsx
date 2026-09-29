'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Feedback, remembering which page it was opened from. */
export function FeedbackLink() {
  const pathname = usePathname();
  const from = pathname && pathname !== '/feedback' ? `?from=${encodeURIComponent(pathname)}` : '';
  return (
    <Link href={`/feedback${from}`} className="muted">
      Feedback
    </Link>
  );
}
