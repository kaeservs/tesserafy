/**
 * Longer than Supabase's own minimum of six, which is too short to be one.
 * Its own module because a 'use server' file may export only async functions.
 */
export const MIN_PASSWORD = 8;
