/**
 * Who the overlay is signed in as, held where the page cannot reach it.
 *
 * It replaces TESSERAFY_TOKEN, an access token pasted into an environment
 * variable: fine for proving the loop, not something a customer can do, and
 * it expired within the hour. Now a person signs in with the same email (or
 * username) and password as the web app, against the same Supabase Auth.
 *
 * What lives where:
 *   - the password: passed once from the page to here, sent to Auth, dropped;
 *   - the access token: in this process's memory only, renewed shortly before
 *     it expires and once more if the API turns it away;
 *   - the refresh token: persisted through the Store the main process gives
 *     this — encrypted by the operating system (Electron's safeStorage), or
 *     not persisted at all when that is unavailable. Never plain text.
 *
 * Auth's address and publishable key come from the web app's public
 * /auth/client-config, so the overlay is configured with one thing: where
 * the product is. Both values already ship to every browser that loads it.
 * The address is still checked before anything is sent to it (`authAllowed`):
 * the password and the refresh token go there, and a web app that named some
 * other address would otherwise be sent both.
 *
 * Storage is passed in rather than imported so this module runs under plain
 * Node — which is how it is checked against the real Auth server without
 * starting Electron.
 */

export interface Store {
  /** The saved refresh token, or null. */
  read(): Promise<string | null>;
  write(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
  /** False when the platform offers no encryption; then nothing is saved. */
  readonly persistent: boolean;
}

interface ClientConfig {
  supabaseUrl: string;
  publishableKey: string;
  usernameDomain: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user?: { email?: string };
}

export type SignInResult = { ok: true; email: string } | { ok: false; message: string };

/** Renew this long before expiry, so a call in flight never carries a dead token. */
const RENEW_BEFORE_MS = 60_000;

/**
 * Auth could not be asked, as distinct from Auth saying no: offline, a
 * timeout, a 429 or a 5xx. A refresh token that could not be checked is not
 * a refresh token that was refused, and throwing it away signed people out
 * for good whenever the overlay started without a network.
 */
class Unreachable extends Error {}

/**
 * Supabase Auth, over https: the only place an installed overlay sends a
 * password or a refresh token (index.ts). A development build is pointed at
 * a local stack, which is neither, so it is not held to this.
 */
export function isSupabaseAuth(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname.endsWith('.supabase.co');
}

/**
 * What a renewal came to. Superseded: someone signed in or out while it was
 * under way, so its answer belongs to a session that has ended.
 */
type Renewal = 'renewed' | 'refused' | 'unreachable' | 'superseded';

export class Session {
  private config: ClientConfig | null = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt = 0;
  private email: string | null = null;
  /**
   * Which session this is. Signing in, signing out and forgetting each start
   * a new one, and a renewal begun under an earlier one adopts nothing and
   * saves nothing when it comes back. Without it, account A's renewal landing
   * after B signed in made the overlay A again, silently, and saved A's
   * token; one landing after a sign-out undid it.
   */
  private generation = 0;
  /** The renewal under way, shared by whoever asks while it is, and which session it is for. */
  private renewing: { generation: number; done: Promise<Renewal> } | null = null;
  /** Told when a session ends without the person signing out: Auth refused its renewal. */
  onSignedOut: (() => void) | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly store: Store,
    private readonly now: () => number = Date.now,
    /** Said on every API call: which overlay this is ("0.1.15 win32"), so the console can show who needs to update. */
    private readonly client: string | null = null,
    /**
     * Whether the Auth address the web app names may be sent a password and
     * a refresh token. Anything, unless told otherwise: tests and a
     * development build use addresses of their own. One that fails is
     * treated as Auth out of reach, so nothing is sent and a saved sign-in is
     * kept rather than forgotten.
     */
    private readonly authAllowed: (url: URL) => boolean = () => true,
  ) {}

  get signedInAs(): string | null {
    return this.accessToken ? this.email : null;
  }

  get remembers(): boolean {
    return this.store.persistent;
  }

  /** A sign-in is held but could not be renewed yet: Auth was out of reach. */
  get waiting(): boolean {
    return this.accessToken === null && this.refreshToken !== null;
  }

  private async clientConfig(): Promise<ClientConfig> {
    if (this.config) return this.config;
    const response = await fetch(new URL('/auth/client-config', this.baseUrl));
    if (!response.ok) throw new Error(`could not reach ${this.baseUrl} (${response.status})`);
    const config = (await response.json()) as ClientConfig;
    // Not kept when it fails, so the next try asks again.
    if (!this.trusted(config.supabaseUrl)) {
      throw new Unreachable('could not reach Tesserafy: it named a sign-in address this overlay does not use');
    }
    this.config = config;
    return this.config;
  }

  private trusted(supabaseUrl: unknown): boolean {
    try {
      return typeof supabaseUrl === 'string' && this.authAllowed(new URL(supabaseUrl));
    } catch {
      return false;
    }
  }

  /** The tokens, or null when Auth refused them; throws Unreachable when Auth could not be asked. */
  private async token(grant: 'password' | 'refresh_token', body: object): Promise<TokenResponse | null> {
    let response: Response;
    try {
      const config = await this.clientConfig();
      response = await fetch(new URL(`/auth/v1/token?grant_type=${grant}`, config.supabaseUrl), {
        method: 'POST',
        headers: { apikey: config.publishableKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new Unreachable(cause instanceof Error ? cause.message : 'could not reach Tesserafy');
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new Unreachable(`Auth answered ${response.status}`);
    }
    if (!response.ok) return null;
    return (await response.json()) as TokenResponse;
  }

  private async adopt(tokens: TokenResponse): Promise<void> {
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    this.expiresAt = tokens.expires_at
      ? tokens.expires_at * 1000
      : this.now() + (tokens.expires_in ?? 3600) * 1000;
    if (tokens.user?.email) this.email = tokens.user.email;
    // Refresh tokens rotate: the one just used is spent, so the new one must
    // replace it or the next launch cannot sign in.
    if (this.store.persistent) await this.store.write(tokens.refresh_token);
  }

  /**
   * At start-up: pick up where the last launch left off, if it can. A saved
   * sign-in is forgotten only when Auth refuses it; out of reach, it is kept
   * (`waiting`) and tried again on the next call that needs it.
   */
  async resume(): Promise<boolean> {
    const saved = await this.store.read();
    if (!saved) return false;
    this.refreshToken = saved;
    return (await this.renew()) === 'renewed';
  }

  async signIn(identifier: string, password: string): Promise<SignInResult> {
    let config: ClientConfig;
    try {
      config = await this.clientConfig();
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : 'could not reach Tesserafy' };
    }
    const trimmed = identifier.trim();
    // The web form's rule, so the same name works in both places.
    const email = trimmed.includes('@') ? trimmed : `${trimmed.toLowerCase()}@${config.usernameDomain}`;
    let tokens: TokenResponse | null;
    try {
      tokens = await this.token('password', { email, password });
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? `Could not reach Tesserafy: ${cause.message}` : 'could not reach Tesserafy' };
    }
    // One message for a wrong password and an unknown account, as the web
    // form gives: saying which would make this an account directory.
    if (!tokens) return { ok: false, message: 'That username and password did not match.' };
    // A new session from here, and only once the password was accepted: a
    // mistyped one leaves whatever was there as it was.
    this.generation += 1;
    this.email = tokens.user?.email ?? email;
    await this.adopt(tokens);
    return { ok: true, email: this.email };
  }

  /**
   * Renews the access token. Concurrent callers share one renewal — unless a
   * sign-in or sign-out has happened since it began: its answer is then not
   * this session's, so a caller from now on gets a renewal of its own.
   */
  private renew(): Promise<Renewal> {
    if (this.renewing?.generation === this.generation) return this.renewing.done;
    const generation = this.generation;
    const done = this.renewal(generation).finally(() => {
      // A later renewal may have taken the slot; that one is not this one's to clear.
      if (this.renewing?.done === done) this.renewing = null;
    });
    this.renewing = { generation, done };
    return done;
  }

  /**
   * One renewal, for the session that was current when it began. Refused,
   * the sign-in is over and forgotten, saved copy included, and onSignedOut
   * says so; out of reach, it is kept for the next try.
   */
  private async renewal(generation: number): Promise<Renewal> {
    try {
      if (!this.refreshToken) return 'refused';
      const tokens = await this.token('refresh_token', { refresh_token: this.refreshToken });
      // Signed in or out while Auth was being asked: the answer, refusal or
      // tokens, is about a session that is no longer this one. Adopting it
      // would bring the last account back, or undo the sign-out, and save
      // its refresh token.
      if (generation !== this.generation) return 'superseded';
      if (!tokens) {
        const wasSignedIn = this.accessToken !== null;
        this.forget();
        await this.store.clear();
        if (wasSignedIn) this.onSignedOut?.();
        return 'refused';
      }
      await this.adopt(tokens);
      return 'renewed';
    } catch {
      // Unreachable, or the saved copy could not be written: the session
      // is not known to be over, so nothing is forgotten.
      return 'unreachable';
    }
  }

  /** A token good for at least the next minute, or null when signed out. */
  async bearer(): Promise<string | null> {
    if (!this.accessToken && !this.refreshToken) return null;
    const generation = this.generation;
    if (!this.accessToken || this.now() > this.expiresAt - RENEW_BEFORE_MS) {
      if ((await this.renew()) !== 'renewed' || generation !== this.generation) return null;
    }
    return this.accessToken;
  }

  /**
   * An API call with the session's token, retried once with a renewed token
   * if the API turns the first away — a token revoked early looks exactly
   * like that.
   */
  async fetch(path: string, init: RequestInit = {}): Promise<Response | null> {
    const call = async (token: string) =>
      fetch(new URL(path, this.baseUrl), {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          authorization: `Bearer ${token}`,
          ...(this.client ? { 'x-tesserafy-overlay': this.client } : {}),
        },
      });

    const generation = this.generation;
    const token = await this.bearer();
    if (!token) return null;
    const first = await call(token);
    if (first.status !== 401) return first;
    // Tried again only as whoever it was first sent as. After a sign-in or a
    // sign-out since, a renewed token is someone else's, or nobody's, and
    // this request still carries what the last person asked.
    if (generation !== this.generation) return first;
    if ((await this.renew()) !== 'renewed' || generation !== this.generation || !this.accessToken) return first;
    return call(this.accessToken);
  }

  /**
   * Signs this overlay out, and only this overlay: the web app stays signed in.
   *
   * Auth ends the session only when asked with a token it still accepts, and
   * the one held may have expired an hour ago — or, offline at start-up,
   * there may be none yet. So a fresh one is had first where it can be; one
   * Auth turned away left the refresh token alive on the server for good.
   */
  async signOut(): Promise<void> {
    // A new session first: a renewal already under way adopts and saves
    // nothing, so it cannot undo this, and any renewal the logout needs is
    // the logout's own.
    this.generation += 1;
    const token = await this.bearer();
    if (token) {
      try {
        const config = await this.clientConfig();
        await fetch(new URL('/auth/v1/logout?scope=local', config.supabaseUrl), {
          method: 'POST',
          headers: { apikey: config.publishableKey, authorization: `Bearer ${token}` },
        });
      } catch {
        // Signing out locally still happens below; the server session then
        // simply expires.
      }
    }
    this.forget();
    await this.store.clear();
  }

  private forget(): void {
    // And a new session again: a renewal begun since (the logout's own, or
    // a call made while it was out) brings nothing back.
    this.generation += 1;
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    this.email = null;
  }
}
