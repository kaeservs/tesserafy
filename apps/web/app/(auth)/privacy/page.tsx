import { redirect } from 'next/navigation';
import { legalUrl } from '@/lib/legal';

export const metadata = { title: 'Privacy Policy · Tesserafy' };
export const dynamic = 'force-dynamic';

export default function PrivacyPage() {
  const url = legalUrl('privacy');
  if (url) redirect(url);
  return (
    <main>
      <h1>Privacy Policy</h1>
      <p>Tesserafy&apos;s Privacy Policy is being finalised and will be published here.</p>
    </main>
  );
}
