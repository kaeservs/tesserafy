import { redirect } from 'next/navigation';

/**
 * Where the plan used to be (/profile#membership). Old links, bookmarks and
 * overlays released before this change still open it, so it sends them on.
 */
export default function ProfilePage(): never {
  redirect('/settings/membership');
}
