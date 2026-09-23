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
        A WebVTT file from Zoom, Meet or Teams, or turns as JSON. It is parsed and stored here;
        extracting signals from it is a second step, because that runs a model an operator pays
        for and a local one a browser cannot reach.
      </p>

      <Upload sets={sets} />

      <section aria-labelledby="after-heading">
        <h2 id="after-heading">What happens next</h2>
        <ol className="muted">
          <li>The transcript is stored and the conversation appears under Meetings as captured.</li>
          <li>
            <code>pnpm score --conversation &lt;id&gt;</code> detects criteria and gives it a
            scorecard.
          </li>
          <li>
            <code>pnpm process --conversation &lt;id&gt;</code> embeds it and extracts signals, so
            it can join an insight.
          </li>
        </ol>
        <p className="muted">
          The conversation page prints whichever of those it is waiting for.
        </p>
      </section>
    </main>
  );
}
