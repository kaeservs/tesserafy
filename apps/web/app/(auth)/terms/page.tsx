import { redirect } from 'next/navigation';
import { legalUrl } from '@/lib/legal';

export const metadata = { title: 'Terms of Service · Tesserafy' };
export const dynamic = 'force-dynamic';

export default function TermsPage() {
  const url = legalUrl('terms');
  if (url) redirect(url);
  return (
    <main>
      <h1>Terms of Service</h1>
      <p>Tesserafy&apos;s Terms of Service are being finalised and will be published here.</p>
      <p>
        One thing they will say, because the product already works this way: Tesserafy never tells the other people on a call
        that it is being transcribed. Telling everyone on the call, and getting their agreement, is the responsibility of whoever
        uses it — which is what you agree to once, before your first recorded call, and what every call&apos;s record cites.
      </p>
    </main>
  );
}
