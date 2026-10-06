import type { ReactNode } from 'react';
import { ACCOUNT_TABS, SectionTabs } from '@/components/section-tabs';

/** The signed-in person's own account: profile, overlay, calendar, deleting it — each at its own path. */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <main>
      <h1>Your account</h1>
      <SectionTabs label="Your account" tabs={ACCOUNT_TABS} />
      {children}
    </main>
  );
}
