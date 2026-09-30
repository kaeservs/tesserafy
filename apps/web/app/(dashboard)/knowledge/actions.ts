'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/** Delete a document and its passages. Owners; the database checks. */
export async function deleteDocument(formData: FormData): Promise<void> {
  const id = formData.get('documentId');
  if (typeof id !== 'string') return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_knowledge_document', { p_document_id: id });
  if (error) throw new Error(error.message.replace(/^[a-z_]+: /, ''));
  revalidatePath('/knowledge');
}
