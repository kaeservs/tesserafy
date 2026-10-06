import { redirect } from 'next/navigation';

/** Settings opens on the membership: the first thing most people come here for. */
export default function SettingsPage(): never {
  redirect('/settings/membership');
}
