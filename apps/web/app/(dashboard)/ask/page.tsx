import { QUESTION_MAX_CHARS } from '@tesserafy/ai';
import { AskBox } from '@/components/ask-box';
import { ASK_PERIODS } from '@/lib/ask';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Ask · Tesserafy' };

/**
 * "Ask your calls" (ADR 0018): a question across every call the company has,
 * answered by an agent that searches them — and its documents — and quotes
 * what it found. Search finds a sentence; this answers a question.
 */
export default async function AskPage() {
  const supabase = await createClient();
  const { data: accounts } = await supabase.from('accounts').select('id, name').order('name');
  return (
    <main>
      <h1>Ask your calls</h1>
      <p className="muted">
        Ask anything about what customers have said. It searches your calls and your documents, reads around what it
        finds, and answers with quotes — each linked to the moment it was said. Anything it cannot quote, it leaves out.
      </p>
      <AskBox maxLength={QUESTION_MAX_CHARS} accounts={accounts ?? []} periods={ASK_PERIODS} />
    </main>
  );
}
