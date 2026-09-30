/**
 * "Not right": what a person says about something the AI wrote. Kept in a
 * plain module so the server actions and the client form share the type
 * (a 'use client' module's exports become client references on the server).
 */
export type FeedbackState = { status: 'idle' } | { status: 'saved' } | { status: 'error'; message: string };

export const FEEDBACK_START: FeedbackState = { status: 'idle' };

/** The database's rule, said before the round trip. */
export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** A database error, without the function name it starts with. */
export const withoutPrefix = (message: string) => message.replace(/^[a-z_]+: /, '');
