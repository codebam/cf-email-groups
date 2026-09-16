import { useState } from 'preact/hooks';
import type { GroupSummary, SessionUser } from '../lib/types';
import { api, copyText } from './api';
import { EmptyState, Field, formatNumber, Modal, Spinner, useToasts } from './ui';

interface Props {
  user: SessionUser;
  groups: GroupSummary[];
}

export default function Dashboard({ user, groups: initialGroups }: Props) {
  const [groups] = useState(initialGroups);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const { push, host } = useToasts();

  const create = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ group: { slug: string } }>('/api/groups', {
        method: 'POST',
        body: { name, description },
      });
      push('success', 'List created');
      window.location.href = `/app/groups/${result.group.slug}`;
    } catch (error) {
      push('error', error instanceof Error ? error.message : 'Could not create the list.');
      setBusy(false);
    }
  };

  const copyPublicLink = async (group: GroupSummary) => {
    const ok = await copyText(`${window.location.origin}/join/${group.slug}`);
    push(ok ? 'success' : 'error', ok ? 'Sign-up link copied' : 'Could not copy the link');
  };

  return (
    <div class="page">
      <div class="page-header">
        <div class="grow">
          <h1>Your email lists</h1>
          <p class="muted" style="margin:0">
            Signed in as <strong>{user.name || user.login}</strong>. Lists you own or administer appear here.
          </p>
        </div>
        <button type="button" class="btn" onClick={() => setShowCreate(true)}>
          + New list
        </button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="No lists yet"
          action={
            <button type="button" class="btn" onClick={() => setShowCreate(true)}>
              Create your first list
            </button>
          }
        >
          A list has its own public sign-up page, subscribers, and campaigns.
        </EmptyState>
      ) : (
        <div class="grid grid-auto">
          {groups.map((group) => (
            <article key={group.id} class="card list-card">
              <div class="row">
                <h2 class="grow truncate" style="margin:0;font-size:1.1rem">
                  {group.name}
                </h2>
                <span class={`badge ${group.role === 'owner' ? 'badge-owner' : 'badge-neutral'}`}>
                  {group.role === 'owner' ? 'Owner' : 'Admin'}
                </span>
              </div>
              {group.description ? <p class="muted small" style="margin:0">{group.description}</p> : null}
              <div class="row small muted" style="gap:1rem">
                <span>
                  <strong>{formatNumber(group.activeCount)}</strong> active
                </span>
                <span>
                  <strong>{formatNumber(group.pendingCount)}</strong> pending
                </span>
                <span>
                  <strong>{formatNumber(group.totalCount)}</strong> total
                </span>
              </div>
              <div class="public-link">
                <code>/join/{group.slug}</code>
                <button type="button" class="btn btn-ghost btn-sm" onClick={() => copyPublicLink(group)} title="Copy sign-up link">
                  Copy
                </button>
              </div>
              <div class="row">
                <a class="btn btn-sm" href={`/app/groups/${group.slug}`}>
                  Manage
                </a>
                <a class="btn btn-secondary btn-sm" href={`/join/${group.slug}`} target="_blank" rel="noreferrer">
                  View sign-up page
                </a>
              </div>
            </article>
          ))}
        </div>
      )}

      {showCreate ? (
        <Modal
          title="Create a list"
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <button type="button" class="btn btn-secondary" onClick={() => setShowCreate(false)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="create-list-form" class="btn" disabled={busy}>
                {busy ? <Spinner /> : null}
                Create list
              </button>
            </>
          }
        >
          <form id="create-list-form" onSubmit={create}>
            <Field label="List name" required hint="Shown in emails and on the sign-up page.">
              <input
                class="input"
                value={name}
                onInput={(event) => setName((event.target as HTMLInputElement).value)}
                placeholder="e.g. Toronto Runners Club"
                maxLength={120}
                required
              />
            </Field>
            <Field label="Description" hint="Optional — appears on the public sign-up page.">
              <textarea
                class="textarea"
                style="min-height:90px"
                value={description}
                onInput={(event) => setDescription((event.target as HTMLTextAreaElement).value)}
                placeholder="A short description of what you'll send."
                maxLength={2000}
              />
            </Field>
          </form>
        </Modal>
      ) : null}
      {host}
    </div>
  );
}
