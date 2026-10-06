import { redirect } from 'next/navigation';

/** /membership, as people say it, is Settings → Membership. */
export default function MembershipShortcut(): never {
  redirect('/settings/membership');
}
