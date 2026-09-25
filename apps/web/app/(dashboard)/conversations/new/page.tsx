import Link from 'next/link';
import { fetchCriteriaSets } from '@tesserafy/db';
import { createClient } from '@/lib/supabase/server';
import { Upload } from './upload';

/**
 * The front door.
 *
 * Everything downstream of an import has worked for a while; the import was
 * `pnpm ingest`, so a person could read this product and add nothing to it.
 * This is the page that closes that.
 *
 * It is deliberate about what it does not promise. A transcript lands with
 * its segments and no embeddings and no signals, because the embedder is a
 * model on an operator's machine that a web request cannot reach. That is a
 * real state and a visible one — the conversation reads "captured" and says
 * which command moves it on. Saying "imported" and stopping would leave
 * somebody waiting for insights that nothing was ever going to produce.
 */
export default async function NewConversationPage() {
  const supabase = await createClient();
  const sets = await fetchCriteriaSets(supabase);

  return (
    <main>
      <p>
        <Link href="/conversations">← Meetings</Link>
      </p>
      <h1>Import a transcript</h1>
      <p className="muted">
        A WebVTT file from Zoom, Meet or Teams, or turns as JSON. Email addresses and phone numbers
        in it are masked before anything is stored.
      </p>

      <Upload sets={sets} />

      <section aria-labelledby="after-heading">
        <h2 id="after-heading">What happens next</h2>
        <ol className="muted">
          <li>You are taken straight to the call. It is under Meetings from then on.</li>
          <li>
            It is scored against your criteria and indexed for search on its own, usually within
            a couple of minutes. The page refreshes itself while it waits.
          </li>
          <li>
            When you want the problems the customer raised and what they asked for, press{' '}
            <strong>Find insights in this call</strong>. It runs a larger model, so it runs when
            you ask rather than on every upload.
          </li>
        </ol>
      </section>
    </main>
  );
}
