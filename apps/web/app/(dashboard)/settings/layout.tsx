import type { ReactNode } from 'react';
import { SectionTabs, SETTINGS_TABS } from '@/components/section-tabs';

/** Company settings: membership, team, calls, integrations and data, each at its own path. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <main>
      <h1>Settings</h1>
      <SectionTabs label="Settings" tabs={SETTINGS_TABS} />
      {children}
    </main>
  );
}
