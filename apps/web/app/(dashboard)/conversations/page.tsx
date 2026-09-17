import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

/**
 * No company filter in this query, on purpose. It runs as the signed-in user,
 * so RLS alone decides which rows come back — this page is the "via API" leg
 * of the P0 gate made visible.
 */
export default async function ConversationsPage() {
  const supabase = await createClient();
  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('id, title, occurred_at, companies ( name )')
    .order('occurred_at', { ascending: false });

  if (error) {
    throw new Error(`Could not load conversations: ${error.message}`);
  }

  return (
    <main>
      <h1>Conversations</h1>
      {conversations.length === 0 ? (
        <p className="muted">
          Nothing here yet. If you expected conversations, your account may not be attached to a
          company.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {conversations.map((c) => (
            <li key={c.id} style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <Link href={`/conversations/${c.id}`}>{c.title}</Link>
              </div>
              <div className="muted">
                {companyName(c.companies)}
                {c.occurred_at && ` · ${new Date(c.occurred_at).toLocaleDateString('en-GB')}`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// Without generated types, supabase-js cannot tell a to-one embed from a
// to-many one. Replace with packages/db generated types once they exist.
function companyName(embed: unknown): string {
  const row = Array.isArray(embed) ? embed[0] : embed;
  return (row as { name?: string } | undefined)?.name ?? '';
}
