'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  connectTracker,
  disconnectTracker,
  type TrackerState,
} from '@/app/(dashboard)/settings/tracker-actions';

const START: TrackerState = { status: 'idle' };

type Provider = 'github' | 'jira' | 'linear';

const NAME: Record<Provider, string> = { github: 'GitHub', jira: 'Jira', linear: 'Linear' };

export interface ConnectedTracker {
  provider: Provider;
  target: string;
  tokenHint: string;
  connectedBy: string | null;
  connectedAt: string;
}

/** Where a connected tracker lives, as a link a person can open. */
function trackerLink(provider: Provider, target: string): { href: string; label: string } {
  if (provider === 'jira') {
    const [site, project] = target.split('/');
    return { href: `https://${site}/browse/${project}`, label: `${project} on ${site}` };
  }
  if (provider === 'linear') return { href: 'https://linear.app', label: `the ${target} team in Linear` };
  return { href: `https://github.com/${target}`, label: `github.com/${target}` };
}

/**
 * Where approved insights become tickets: the company's own GitHub repository,
 * Jira Cloud project or Linear team.
 *
 * The token fields are password fields held in state only until they are sent;
 * a token is never shown again, only its last four characters. Replacing one is
 * connecting again. Disconnecting takes two clicks, because it stops every
 * member from raising tickets until someone reconnects.
 */
export function TrackerPanel({
  connected,
  isOwner,
  available,
  connectedDate,
}: {
  connected: ConnectedTracker | null;
  isOwner: boolean;
  available: boolean;
  connectedDate: string | null;
}) {
  const [state, connect, connecting] = useActionState(connectTracker, START);
  const [, disconnect, disconnecting] = useActionState(disconnectTracker, START);
  const [provider, setProvider] = useState<Provider>(connected?.provider ?? 'github');
  // Held in state, not left to the inputs: React resets a form's uncontrolled
  // fields after each submission, and a refused connection should leave what
  // the owner typed where they typed it.
  const [jiraSite0, jiraProject0] = connected?.provider === 'jira' ? connected.target.split('/') : ['', ''];
  const [fields, setFields] = useState({
    repository: connected?.provider === 'github' ? connected.target : '',
    site: jiraSite0 ?? '',
    project: jiraProject0 ?? '',
    email: '',
    team: connected?.provider === 'linear' ? connected.target : '',
  });
  const field = (name: keyof typeof fields) => ({
    name,
    value: fields[name],
    onChange: (event: { target: { value: string } }) => setFields((current) => ({ ...current, [name]: event.target.value })),
  });
  const [token, setToken] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Once it is stored the token has no business staying in the page.
  useEffect(() => {
    if (state.status !== 'connected') return;
    setToken('');
    setReplacing(false);
  }, [state]);

  const where = connected ? trackerLink(connected.provider, connected.target) : null;
  const summary =
    connected && where ? (
      <p>
        Approved insights become {connected.provider === 'github' ? 'issues' : 'tickets'} in{' '}
        <a href={where.href} target="_blank" rel="noreferrer">
          {where.label}
        </a>{' '}
        ({NAME[connected.provider]}).{' '}
        <span className="muted">
          Token ending {connected.tokenHint}
          {connected.connectedBy ? `, connected by ${connected.connectedBy}` : ''}
          {connectedDate ? ` on ${connectedDate}` : ''}.
        </span>
      </p>
    ) : (
      <p className="muted">
        No tracker is connected, so approved insights cannot become tickets yet.
        {isOwner ? '' : ' An owner can connect one here.'}
      </p>
    );

  if (!isOwner) return summary;
  if (!available) {
    return (
      <>
        {summary}
        <p className="muted" style={{ marginBottom: 0 }}>
          Connecting a tracker is not switched on for this deployment yet.
        </p>
      </>
    );
  }

  const showForm = !connected || replacing;

  return (
    <>
      {summary}
      {state.status === 'connected' ? <p role="status">Connected to {state.target}.</p> : null}

      {showForm ? (
        <form action={connect}>
          <div className="field">
            <label htmlFor="tracker-provider">Tracker</label>
            <select
              id="tracker-provider"
              name="provider"
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value as Provider);
                setToken('');
              }}
            >
              <option value="github">GitHub</option>
              <option value="jira">Jira Cloud</option>
              <option value="linear">Linear</option>
            </select>
          </div>

          {provider === 'github' ? (
            <div className="field">
              <label htmlFor="tracker-repository">GitHub repository</label>
              <input
                id="tracker-repository"
                required
                placeholder="acme/product or https://github.com/acme/product"
                {...field('repository')}
              />
            </div>
          ) : null}
          {provider === 'jira' ? (
            <>
              <div className="field">
                <label htmlFor="tracker-site">Jira site</label>
                <input id="tracker-site" required placeholder="acme.atlassian.net" {...field('site')} />
              </div>
              <div className="field">
                <label htmlFor="tracker-project">Project key</label>
                <input id="tracker-project" required placeholder="PROD" {...field('project')} />
              </div>
              <div className="field">
                <label htmlFor="tracker-email">Atlassian account email</label>
                <input id="tracker-email" type="email" required autoComplete="off" {...field('email')} />
              </div>
            </>
          ) : null}
          {provider === 'linear' ? (
            <div className="field">
              <label htmlFor="tracker-team">Team key</label>
              <input id="tracker-team" required placeholder="ENG" {...field('team')} />
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="tracker-token">{provider === 'github' ? 'Access token' : provider === 'jira' ? 'API token' : 'API key'}</label>
            <input
              id="tracker-token"
              name="token"
              type="password"
              required
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
          <p className="muted">
            {provider === 'github'
              ? 'Create a fine-grained token in GitHub (Settings → Developer settings → Fine-grained tokens) with access to this one repository and one permission: Issues, read and write.'
              : provider === 'jira'
                ? 'Create an API token for the Atlassian account at id.atlassian.com → Security → API tokens. The account needs permission to create issues in this project. Jira Cloud only.'
                : 'Create a personal API key in Linear (Settings → Security & access → Personal API keys) for an account that can create issues in this team.'}{' '}
            It is checked with {NAME[provider]} now, stored encrypted, and never shown again.
          </p>
          {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
          <div className="toolbar">
            <button type="submit" disabled={connecting}>
              {connecting ? `Checking with ${NAME[provider]}…` : connected ? 'Replace' : 'Connect'}
            </button>
            {replacing ? (
              <button type="button" onClick={() => setReplacing(false)} disabled={connecting}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="toolbar">
          <button type="button" onClick={() => setReplacing(true)}>
            Change tracker or token
          </button>
          {confirmDisconnect ? (
            <form action={disconnect} className="remove-confirm">
              <span>Disconnect? Nobody can raise tickets until it is connected again.</span>
              <button type="submit" disabled={disconnecting}>
                {disconnecting ? 'Disconnecting…' : 'Yes, disconnect'}
              </button>
              <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={disconnecting}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </button>
          )}
        </div>
      )}
    </>
  );
}
