import { useState } from 'preact/hooks';
import type { GroupAdmin, GroupDetail, SessionUser } from '../lib/types';
import { api, copyText } from './api';
import { ConfirmDialog, Field, type PushToast, RoleBadge, Spinner, useToasts } from './ui';

interface Props {
  user: SessionUser;
  group: GroupDetail;
  initialAdmins: GroupAdmin[];
  publicUrl: string;
  push: PushToast;
  onGroupChange: (group: GroupDetail) => void;
  /** False on dedicated single-list deployments where the list is permanent. */
  allowDelete?: boolean;
}

export default function SettingsTab({ user, group, initialAdmins, publicUrl, push, onGroupChange, allowDelete = true }: Props) {
  const [form, setForm] = useState({
    name: group.name,
    description: group.description,
    fromName: group.fromName,
    fromEmail: group.fromEmail,
    replyTo: group.replyTo,
    doubleOptIn: group.doubleOptIn,
    publicSignup: group.publicSignup,
  });
  const [saving, setSaving] = useState(false);
  const [admins, setAdmins] = useState(initialAdmins);
  const [inviteLogin, setInviteLogin] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'owner'>('admin');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<GroupAdmin | null>(null);
  const [confirmSlug, setConfirmSlug] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { push: localPush, host } = useToasts();
  const notify: PushToast = (kind, message) => {
    push(kind, message);
    localPush(kind, message);
  };

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (event: Event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api<{ group: GroupDetail }>(`/api/groups/${group.id}`, { method: 'PATCH', body: form });
      onGroupChange(result.group);
      notify('success', 'List settings saved');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const addAdmin = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ admins: GroupAdmin[]; pending: boolean }>(`/api/groups/${group.id}/admins`, {
        method: 'POST',
        body: { login: inviteLogin, role: inviteRole },
      });
      setAdmins(result.admins);
      setInviteLogin('');
      notify('success', result.pending ? 'Invitation saved — they become an admin at first sign-in.' : 'Admin added');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not add that admin.');
    } finally {
      setBusy(false);
    }
  };

  const removeAdmin = async (admin: GroupAdmin) => {
    setBusy(true);
    try {
      const result = admin.pending
        ? await api<{ admins: GroupAdmin[] }>(`/api/groups/${group.id}/admins`, { method: 'DELETE', body: { login: admin.login } })
        : await api<{ admins: GroupAdmin[] }>(`/api/groups/${group.id}/admins/${admin.userId}`, { method: 'DELETE' });
      setAdmins(result.admins);
      notify('success', 'Admin removed');
      setRemoving(null);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not remove that admin.');
    } finally {
      setBusy(false);
    }
  };

  const deleteList = async () => {
    setBusy(true);
    try {
      await api(`/api/groups/${group.id}`, { method: 'DELETE', body: { confirmSlug } });
      window.location.href = '/app';
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not delete the list.');
      setBusy(false);
    }
  };

  const copyLink = async () => {
    const ok = await copyText(publicUrl);
    notify(ok ? 'success' : 'error', ok ? 'Public link copied' : 'Could not copy the link');
  };

  return (
    <div class="grid" style="gap:1.5rem">
      <form class="card card-body" onSubmit={save}>
        <h3>List settings</h3>
        <div class="grid grid-2">
          <Field label="List name" required>
            <input class="input" value={form.name} maxLength={120} onInput={(event) => set('name', (event.target as HTMLInputElement).value)} required />
          </Field>
          <Field label="Description">
            <input class="input" value={form.description} maxLength={2000} onInput={(event) => set('description', (event.target as HTMLInputElement).value)} />
          </Field>
          <Field label="From name" hint="The display name subscribers see.">
            <input class="input" value={form.fromName} maxLength={120} onInput={(event) => set('fromName', (event.target as HTMLInputElement).value)} />
          </Field>
          <Field label="From email" hint="Must be on a domain verified by your email provider. Falls back to EMAIL_FROM.">
            <input class="input" type="email" value={form.fromEmail} onInput={(event) => set('fromEmail', (event.target as HTMLInputElement).value)} />
          </Field>
          <Field label="Reply-to" hint="Where replies go. Optional.">
            <input class="input" type="email" value={form.replyTo} onInput={(event) => set('replyTo', (event.target as HTMLInputElement).value)} />
          </Field>
        </div>
        <div class="stack" style="margin:0.5rem 0 1rem">
          <label class="checkbox">
            <input type="checkbox" checked={form.doubleOptIn} onChange={(event) => set('doubleOptIn', (event.target as HTMLInputElement).checked)} />
            <span>
              <strong>Double opt-in</strong>
              <span class="muted small" style="display:block">
                New public sign-ups must click a confirmation link before becoming active.
              </span>
            </span>
          </label>
          <label class="checkbox">
            <input type="checkbox" checked={form.publicSignup} onChange={(event) => set('publicSignup', (event.target as HTMLInputElement).checked)} />
            <span>
              <strong>Public sign-up page</strong>
              <span class="muted small" style="display:block">
                Anyone with the link can join this list.
              </span>
            </span>
          </label>
        </div>
        <div class="row">
          <button type="submit" class="btn" disabled={saving}>
            {saving ? <Spinner /> : null}
            Save settings
          </button>
        </div>
      </form>

      <section class="card card-body">
        <h3>Public sign-up link</h3>
        <div class="public-link">
          <code>{publicUrl}</code>
          <button type="button" class="btn btn-ghost btn-sm" onClick={() => void copyLink()}>
            Copy
          </button>
          <a class="btn btn-secondary btn-sm" href={publicUrl} target="_blank" rel="noreferrer">
            Open
          </a>
        </div>
      </section>

      <section class="card card-body">
        <div class="row">
          <h3 class="grow" style="margin:0">
            Admins
          </h3>
        </div>
        <p class="muted small">Admins can manage subscribers and campaigns. Only the owner can rename, transfer, or delete the list.</p>
        <div>
          {admins.map((admin) => (
            <div key={admin.pending ? `pending:${admin.login}` : admin.userId} class="admin-row">
              {admin.avatarUrl ? <img class="avatar" src={admin.avatarUrl} alt="" /> : <span class="avatar avatar-fallback">{admin.login.slice(0, 1).toUpperCase()}</span>}
              <div class="grow" style="min-width:0">
                <div style="font-weight:600" class="truncate">
                  {admin.name || admin.login}
                  {admin.userId === user.id ? <span class="muted small"> (you)</span> : null}
                </div>
                <div class="muted small truncate">@{admin.login}</div>
              </div>
              <RoleBadge role={admin.role} pending={admin.pending} />
              {admin.role !== 'owner' ? (
                <button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger)" disabled={busy} onClick={() => setRemoving(admin)}>
                  {admin.pending ? 'Cancel invite' : 'Remove'}
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <form class="row" style="margin-top:1rem;align-items:flex-end" onSubmit={addAdmin}>
          <div class="grow">
            <Field label="Invite by GitHub username">
              <input
                class="input"
                value={inviteLogin}
                onInput={(event) => setInviteLogin((event.target as HTMLInputElement).value)}
                placeholder="octocat"
                maxLength={39}
                required
              />
            </Field>
          </div>
          <div style="width:130px">
            <Field label="Role">
              <select class="select" value={inviteRole} onChange={(event) => setInviteRole((event.target as HTMLSelectElement).value as 'admin' | 'owner')}>
                <option value="admin">Admin</option>
                {group.role === 'owner' ? <option value="owner">Owner</option> : null}
              </select>
            </Field>
          </div>
          <button type="submit" class="btn" style="margin-bottom:0.9rem" disabled={busy}>
            {busy ? <Spinner /> : 'Add'}
          </button>
        </form>
        {group.role !== 'owner' ? <p class="muted small">Only the owner can transfer ownership.</p> : null}
      </section>

      {allowDelete === false ? (
        <p class="muted small">
          This deployment is dedicated to <strong>{group.name}</strong>, so the list can't be deleted here. Update
          <code>SINGLE_LIST_*</code> configuration and redeploy to change it.
        </p>
      ) : null}

      {group.role === 'owner' && allowDelete ? (
        <section class="danger-zone">
          <h3>Danger zone</h3>
          <p class="muted small">
            Deleting <strong>{group.name}</strong> permanently removes its subscribers, campaigns, and admin memberships.
          </p>
          <button type="button" class="btn btn-danger" onClick={() => setDeleteOpen(true)}>
            Delete this list
          </button>
        </section>
      ) : null}

      {removing ? (
        <ConfirmDialog
          title={removing.pending ? 'Cancel invitation?' : 'Remove admin?'}
          confirmLabel={removing.pending ? 'Cancel invite' : 'Remove'}
          busy={busy}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void removeAdmin(removing)}
        >
          <p>
            {removing.pending ? 'Cancel the pending invite for ' : 'Remove '}
            <strong>@{removing.login}</strong>?
          </p>
        </ConfirmDialog>
      ) : null}

      {deleteOpen ? (
        <ConfirmDialog title="Delete this list" confirmLabel="Delete forever" busy={busy} onCancel={() => setDeleteOpen(false)} onConfirm={() => void deleteList()}>
          <p>
            Type <strong>{group.slug}</strong> to confirm. This cannot be undone.
          </p>
          <Field label="List slug">
            <input class="input" value={confirmSlug} onInput={(event) => setConfirmSlug((event.target as HTMLInputElement).value)} placeholder={group.slug} />
          </Field>
        </ConfirmDialog>
      ) : null}
      {host}
    </div>
  );
}
