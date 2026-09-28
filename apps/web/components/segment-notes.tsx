'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  addNote,
  deleteNote,
  editNote,
  type NoteState,
} from '@/app/(dashboard)/conversations/[id]/call-actions';

const START: NoteState = { status: 'idle' };

export interface ShownNote {
  readonly id: string;
  readonly body: string;
  readonly author: string;
  readonly when: string;
  readonly edited: boolean;
  readonly mine: boolean;
  readonly removable: boolean;
}

function OneNote({ note, conversationId }: { note: ShownNote; conversationId: string }) {
  const [editing, setEditing] = useState(false);
  const [edited, edit, saving] = useActionState(editNote, START);
  const [removed, remove, removing] = useActionState(deleteNote, START);

  useEffect(() => {
    if (edited.status === 'saved') setEditing(false);
  }, [edited]);

  return (
    <li className="note">
      {editing ? (
        <form action={edit}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="noteId" value={note.id} />
          <label className="visually-hidden" htmlFor={`note-edit-${note.id}`}>
            Your note
          </label>
          <textarea id={`note-edit-${note.id}`} name="body" defaultValue={note.body} maxLength={2000} required />
          <div className="toolbar">
            <button type="submit" disabled={saving}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p>{note.body}</p>
      )}
      <div className="muted note-meta">
        {note.author}, {note.when}
        {note.edited ? ' (edited)' : ''}
        {note.mine && !editing ? (
          <button type="button" className="link-button" onClick={() => setEditing(true)}>
            Edit
          </button>
        ) : null}
        {note.removable ? (
          <form action={remove} className="inline-form">
            <input type="hidden" name="conversationId" value={conversationId} />
            <input type="hidden" name="noteId" value={note.id} />
            <button type="submit" className="link-button" disabled={removing}>
              Remove
            </button>
          </form>
        ) : null}
      </div>
      {edited.status === 'error' ? <p role="alert">{edited.message}</p> : null}
      {removed.status === 'error' ? <p role="alert">{removed.message}</p> : null}
    </li>
  );
}

/**
 * Notes on one moment of a call, and a way to add one.
 *
 * Coaching is pointing at a moment and saying something about it, so the note
 * sits under the words it is about rather than in a box at the bottom of the
 * page. The form stays closed until asked for: a transcript is read far more
 * than it is annotated, and a text box under every line would bury it.
 */
export function SegmentNotes({
  conversationId,
  segmentId,
  notes,
}: {
  conversationId: string;
  segmentId: string;
  notes: readonly ShownNote[];
}) {
  const [open, setOpen] = useState(false);
  const [added, add, adding] = useActionState(addNote, START);
  const [body, setBody] = useState('');

  useEffect(() => {
    if (added.status !== 'saved') return;
    setBody('');
    setOpen(false);
  }, [added]);

  return (
    <div className="segment-notes">
      {notes.length > 0 ? (
        <ul className="notes">
          {notes.map((note) => (
            <OneNote key={note.id} note={note} conversationId={conversationId} />
          ))}
        </ul>
      ) : null}
      {open ? (
        <form action={add}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="segmentId" value={segmentId} />
          <label className="visually-hidden" htmlFor={`note-${segmentId}`}>
            A note on this moment
          </label>
          <textarea
            id={`note-${segmentId}`}
            name="body"
            value={body}
            maxLength={2000}
            placeholder="What was good here, or what to try instead"
            onChange={(event) => setBody(event.target.value)}
            required
          />
          <div className="toolbar">
            <button type="submit" disabled={adding || body.trim().length === 0}>
              {adding ? 'Saving…' : 'Add note'}
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          {added.status === 'error' ? <p role="alert">{added.message}</p> : null}
        </form>
      ) : (
        <button type="button" className="link-button note-add" onClick={() => setOpen(true)}>
          Add a note
        </button>
      )}
    </div>
  );
}
