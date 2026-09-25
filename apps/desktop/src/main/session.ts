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

export class Session {
  private config: ClientConfig | null = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt = 0;
  private email: string | null = null;
  private renewing: Promise<boolean> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {}

  get signedInAs(): string | null {
    return this.accessToken ? this.email : null;
  }

  get remembers(): boolean {
    return this.store.persistent;
  }

  private async clientConfig(): Promise<ClientConfig> {
    if (this.config) return this.config;
    const response = await fetch(new URL('/auth/client-config', this.baseUrl));
    if (!response.ok) throw new Error(`could not reach ${this.baseUrl} (${response.status})`);
    this.config = (await response.json()) as ClientConfig;
    return this.config;
  }

  private async token(grant: 'password' | 'refresh_token', body: object): Promise<TokenResponse | null> {
    const config = await this.clientConfig();
    const response = await fetch(new URL(`/auth/v1/token?grant_type=${grant}`, config.supabaseUrl), {
      method: 'POST',
      headers: { apikey: config.publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
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

  /** At start-up: pick up where the last launch left off, if it can. */
  async resume(): Promise<boolean> {
    const saved = await this.store.read();
    if (!saved) return false;
    this.refreshToken = saved;
    const ok = await this.renew();
    if (!ok) await this.store.clear();
    return ok;
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
    const tokens = await this.token('password', { email, password });
    // One message for a wrong password and an unknown account, as the web
    // form gives: saying which would make this an account directory.
    if (!tokens) return { ok: false, message: 'That username and password did not match.' };
    this.email = tokens.user?.email ?? email;
    await this.adopt(tokens);
    return { ok: true, email: this.email };
  }

  /** Renews the access token. Concurrent callers share one renewal. */
  private renew(): Promise<boolean> {
    if (this.renewing) return this.renewing;
    this.renewing = (async () => {
      try {
        if (!this.refreshToken) return false;
        const tokens = await this.token('refresh_token', { refresh_token: this.refreshToken });
        if (!tokens) {
          this.forget();
          return false;
        }
        await this.adopt(tokens);
        return true;
      } catch {
        return false;
      } finally {
        this.renewing = null;
      }
    })();
    return this.renewing;
  }

  /** A token good for at least the next minute, or null when signed out. */
  async bearer(): Promise<string | null> {
    if (!this.accessToken && !this.refreshToken) return null;
    if (!this.accessToken || this.now() > this.expiresAt - RENEW_BEFORE_MS) {
      if (!(await this.renew())) return null;
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
        headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
      });

    const token = await this.bearer();
    if (!token) return null;
    const first = await call(token);
    if (first.status !== 401) return first;
    if (!(await this.renew()) || !this.accessToken) return first;
    return call(this.accessToken);
  }

  /** Signs this overlay out, and only this overlay: the web app stays signed in. */
  async signOut(): Promise<void> {
    const token = this.accessToken;
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
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    this.email = null;
  }
}
