/**
 * Keeping a live call, without slowing it down.
 *
 * The ordering rule this exists to enforce: nothing here may sit between
 * somebody finishing a sentence and the score moving. The conversation is
 * created when recording starts, each utterance is posted *alongside*
 * detection rather than before it, and the evidence is posted after the score
 * is already on screen.
 *
 * That leaves one problem, which is the whole of this file. A detector event
 * refers to a segment by the id the window used — a local id, because the
 * utterance was still in flight when detection began — and the database knows
 * it by the id it assigned. So every local id has a promise of a server id
 * attached to it, and the evidence post waits on exactly the ones its events
 * mention. Waiting there costs nothing: the score is already drawn.
 *
 * Failure is quiet on purpose. A saved call is worth having and no part of it
 * is worth interrupting a meeting for, so a dropped write leaves the live
 * scorecard exactly as it was and the session reports how many it lost.
 *
 * The same rule is implemented again in apps/desktop/src/renderer/renderer.js,
 * because the overlay writes through IPC rather than fetch and shares no
 * module with this one. It is sixty lines and the transports differ, so the
 * duplication is deliberate rather than extracted — but the *rule* must not
 * drift, so a change here is a change there. The tests in
 * apps/web/test/live-session.test.ts pin the behaviour for both.
 */

export interface LiveEvent {
  criterionKey: string;
  kind: 'evidence' | 'contradiction';
  confidence: number;
  /** The local id used in the detection window. */
  segmentId: string;
  quote: string;
  detector: string;
  model: string;
}

export interface LiveSessionState {
  conversationId: string | null;
  /** Utterances the server has acknowledged. */
  saved: number;
  /** Evidence rows the server accepted. */
  recorded: number;
  /** Writes that failed, so the page can say so rather than imply success. */
  lost: number;
}

type Listener = (state: LiveSessionState) => void;

export class LiveSession {
  private conversationId: string | null = null;
  private readonly serverIds = new Map<string, Promise<string | null>>();
  private state: LiveSessionState = { conversationId: null, saved: 0, recorded: 0, lost: 0 };
  private readonly listeners = new Set<Listener>();

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.state = { ...this.state, conversationId: this.conversationId };
    for (const listener of this.listeners) listener(this.state);
  }

  /** Called when recording starts. Resolves to null if the call is not kept. */
  async start(title: string, engagementType: string, criteriaVersion: number): Promise<string | null> {
    try {
      const response = await fetch('/api/live/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, engagementType, criteriaVersion }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { conversationId: string };
      this.conversationId = body.conversationId;
      this.emit();
      return this.conversationId;
    } catch {
      // Not being able to keep the call must not stop it being run. The page
      // says the session is not being saved and everything else proceeds.
      this.conversationId = null;
      this.state = { ...this.state, lost: this.state.lost + 1 };
      this.emit();
      return null;
    }
  }

  /**
   * Record an utterance. Returns immediately — the caller starts detection in
   * the same breath, and the server id is awaited later by saveEvents().
   */
  appendSegment(localId: string, utterance: {
    speaker: string | null;
    startMs: number;
    endMs: number;
    text: string;
  }): void {
    const conversationId = this.conversationId;
    if (!conversationId) return;

    const pending = fetch(`/api/live/sessions/${conversationId}/segments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(utterance),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { segmentId: string };
        this.state = { ...this.state, saved: this.state.saved + 1 };
        this.emit();
        return body.segmentId;
      })
      .catch(() => {
        this.state = { ...this.state, lost: this.state.lost + 1 };
        this.emit();
        return null;
      });

    this.serverIds.set(localId, pending);
  }

  /**
   * Save the evidence behind a score, once that score is on screen.
   *
   * Events whose segment never reached the server are dropped rather than
   * sent with a guessed id: evidence that points at nothing is worse than
   * evidence that is missing, because only one of them is visibly absent.
   */
  async saveEvents(events: readonly LiveEvent[]): Promise<void> {
    const conversationId = this.conversationId;
    if (!conversationId || events.length === 0) return;

    const resolved = await Promise.all(
      events.map(async (event) => {
        const serverId = await (this.serverIds.get(event.segmentId) ?? Promise.resolve(null));
        return serverId ? { ...event, segmentId: serverId } : null;
      }),
    );

    const sendable = resolved.filter((event): event is LiveEvent => event !== null);
    if (sendable.length === 0) return;

    try {
      const response = await fetch(`/api/live/sessions/${conversationId}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: sendable }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { recorded: number; rejected: number };
      this.state = {
        ...this.state,
        recorded: this.state.recorded + body.recorded,
        // A rejected claim is not a lost write: the server looked at it and
        // said no, which is the quote rule working.
        lost: this.state.lost,
      };
      this.emit();
    } catch {
      this.state = { ...this.state, lost: this.state.lost + 1 };
      this.emit();
    }
  }

  current(): LiveSessionState {
    return this.state;
  }
}
