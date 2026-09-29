import Link from 'next/link';
import { fetchCriteriaSets } from '@tesserafy/db';
import { myCompanyId, sampleCallOffered } from '@/lib/company';
import { SampleCallButton } from '@/components/sample-call-button';
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
  // The newest version of each set, the company's own first: a new call is
  // scored against what the company uses now.
  const all = await fetchCriteriaSets(supabase, await myCompanyId(supabase));
  const sets = all
    .filter((set) => !all.some((other) => other.engagementType === set.engagementType && other.version > set.version))
    .sort((a, b) => Number(b.own) - Number(a.own));
  const { data: accounts } = await supabase.from('accounts').select('name').order('name').limit(500);
  const offerSample = await sampleCallOffered(supabase);

  return (
    <main>
      <p>
        <Link href="/conversations">← Meetings</Link>
      </p>
      <h1>Import a transcript</h1>
      <p className="muted">
        A transcript with timestamps: WebVTT from Zoom, Meet or Teams, SubRip, a text export from Otter,
        Fireflies or a Meet document, or turns as JSON. Email addresses and phone numbers in it are masked
        before anything is stored.
      </p>
      {offerSample ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>No transcript to hand? See what a scored call looks like first.</p>
          <SampleCallButton />
        </div>
      ) : null}

      <Upload sets={sets} accounts={(accounts ?? []).map((account) => account.name)} />

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
