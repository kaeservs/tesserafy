'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type GuidanceState = { status: 'idle' } | { status: 'saved'; message: string } | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

const reason = (message: string) => message.replace(/^[a-z_]+: /, '');

/** An owner tells one AI feature how to work, for every call type or one. */
export async function addInstruction(_prev: GuidanceState, formData: FormData): Promise<GuidanceState> {
  const supabase = await createClient();
  const engagementType = text(formData, 'engagementType');
  const criterionKey = text(formData, 'criterionKey');
  const { error } = await supabase.rpc('add_ai_instruction', {
    p_feature: text(formData, 'feature'),
    p_body: text(formData, 'body'),
    ...(engagementType ? { p_engagement_type: engagementType } : {}),
    ...(criterionKey ? { p_criterion_key: criterionKey } : {}),
  });
  if (error) return { status: 'error', message: reason(error.message) };
  revalidatePath('/guidance');
  return { status: 'saved', message: 'Saved. The AI follows it from the next call it works on.' };
}

/** Switch a piece of guidance off or on, or delete it. */
export async function changeGuidance(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const change = text(formData, 'change');
  const { error } = await supabase.rpc('set_ai_guidance', {
    p_guidance_id: text(formData, 'guidanceId'),
    ...(change === 'delete' ? { p_delete: true } : { p_active: change === 'on' }),
  });
  if (error) throw new Error(reason(error.message));
  revalidatePath('/guidance');
}

/** What kind of call a scorecard is for, and whether it is the default for new imports. */
export async function setCallType(_prev: GuidanceState, formData: FormData): Promise<GuidanceState> {
  const supabase = await createClient();
  const engagementType = text(formData, 'engagementType');
  const { error } = await supabase.rpc('set_call_type', {
    p_engagement_type: engagementType,
    p_purpose: text(formData, 'purpose'),
    p_make_default: text(formData, 'makeDefault') === 'yes',
  });
  if (error) return { status: 'error', message: reason(error.message) };
  revalidatePath('/guidance');
  revalidatePath('/dashboard');
  revalidatePath('/conversations/new');
  return { status: 'saved', message: 'Saved.' };
}
