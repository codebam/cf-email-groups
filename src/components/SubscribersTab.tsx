import { useState } from 'preact/hooks';
import type { GroupDetail, Subscriber, SubscriberStatus } from '../lib/types';
import { api } from './api';
import {
  ConfirmDialog,
  EmptyState,
  Field,
  formatDate,
  Modal,
  Pagination,
  type PushToast,
  Spinner,
  useToasts,
} from './ui';

interface Props {
  group: GroupDetail;
  initial: Subscriber[];
  initialTotal: number;
  initialPageSize: number;
  push: PushToast;
  onRefreshGroup: () => Promise<void>;
}

type StatusFilter = SubscriberStatus | 'all';
const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'pending', 'unsubscribed', 'bounced', 'complained'];

export default function SubscribersTab({ group, initial, initialTotal, initialPageSize, push, onRefreshGroup }: Props) {
  const [items, setItems] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(initialPageSize);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Subscriber | null>(null);
  const [deleting, setDeleting] = useState<Subscriber | null>(null);
  const { push: localPush, host } = useToasts();
  const notify: PushToast = (kind, message) => {
    push(kind, message);
    localPush(kind, message);
  };

  const load = async (options: { page?: number; status?: StatusFilter; query?: string } = {}) => {
    const nextPage = options.page ?? page;
    const nextStatus = options.status ?? status;
    const nextQuery = options.query ?? query;
    setBusy(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(pageSize),
        status: nextStatus,
      });
      if (nextQuery.trim()) params.set('q', nextQuery.trim());
      const result = await api<{ subscribers: Subscriber[]; total: number; page: number }>(
        `/api/groups/${group.id}/subscribers?${params.toString()}`,
      );
      setItems(result.subscribers);
      setTotal(result.total);
      setPage(result.page);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not load subscribers.');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (value: StatusFilter) => {
    setStatus(value);
    void load({ status: value, page: 1 });
  };

  const addSubscriber = async (event: Event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    setBusy(true);
    try {
      const result = await api<{ warning?: string }>(`/api/groups/${group.id}/subscribers`, {
        method: 'POST',
        body: {
          email: data.get('email'),
          name: data.get('name'),
          status: data.get('status'),
          sendWelcome: data.get('sendWelcome') === 'on',
        },
      });
      notify('success', 'Subscriber added');
      if (result.warning) notify('error', `Subscriber added, but email failed: ${result.warning}`);
      setShowAdd(false);
      await onRefreshGroup();
      await load({ page: 1 });
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not add the subscriber.');
    } finally {
      setBusy(false);
    }
  };

  const updateSubscriber = async (subscriber: Subscriber, patch: Record<string, unknown>, message?: string) => {
    setBusy(true);
    try {
      const result = await api<{ subscriber: Subscriber; warning?: string }>(
        `/api/groups/${group.id}/subscribers/${subscriber.id}`,
        { method: 'PATCH', body: patch },
      );
      setItems((current) => current.map((item) => (item.id === subscriber.id ? result.subscriber : item)));
      if (message) notify('success', message);
      if (result.warning) notify('error', `Saved, but email failed: ${result.warning}`);
      await onRefreshGroup();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not update the subscriber.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteSubscriber = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/api/groups/${group.id}/subscribers/${deleting.id}`, { method: 'DELETE' });
      notify('success', 'Subscriber removed');
      setDeleting(null);
      await onRefreshGroup();
      await load({ page: items.length === 1 && page > 1 ? page - 1 : page });
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not remove the subscriber.');
    } finally {
      setBusy(false);
    }
  };

  const saveImport = async (event: Event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    setBusy(true);
    try {
      const result = await api<{ created: number; updated: number; invalid: number; emailed: number; failedEmails: number }>(
        `/api/groups/${group.id}/import`,
        {
          method: 'POST',
          body: {
            csv: data.get('csv'),
            status: data.get('status'),
            sendConfirmations: data.get('sendConfirmations') === 'on',
          },
        },
      );
      notify(
        'success',
        `Imported ${result.created} new and updated ${result.updated}; ${result.invalid} invalid.` +
          (result.emailed ? ` ${result.emailed} confirmations sent.` : '') +
          (result.failedEmails ? ` ${result.failedEmails} emails failed.` : ''),
      );
      setShowImport(false);
      await onRefreshGroup();
      await load({ page: 1 });
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div class="kpi">
        <div class="kpi-item">
          <div class="kpi-value">{group.counts.active}</div>
          <div class="muted small">Active subscribers</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-value">{group.counts.pending}</div>
          <div class="muted small">Pending confirmation</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-value">{group.counts.unsubscribed}</div>
          <div class="muted small">Unsubscribed</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-value">{group.counts.bounced + group.counts.complained}</div>
          <div class="muted small">Bounced / complained</div>
        </div>
      </div>

      <div class="toolbar">
        <input
          class="input search"
          placeholder="Search email or name…"
          value={query}
          onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void load({ query, page: 1 });
          }}
        />
        <select class="select" style="width:auto" value={status} onChange={(event) => changeStatus((event.target as HTMLSelectElement).value as StatusFilter)}>
          {STATUS_FILTERS.map((filter) => (
            <option key={filter} value={filter}>
              {filter === 'all' ? 'All statuses' : filter.charAt(0).toUpperCase() + filter.slice(1)}
            </option>
          ))}
        </select>
        <button type="button" class="btn btn-secondary" onClick={() => void load({ query, page: 1 })} disabled={busy}>
          {busy ? <Spinner /> : 'Search'}
        </button>
        <div class="right row">
          <button type="button" class="btn btn-secondary" onClick={() => setShowImport(true)}>
            Import CSV
          </button>
          <a class="btn btn-secondary" href={`/api/groups/${group.id}/export`}>
            Export
          </a>
          <button type="button" class="btn" onClick={() => setShowAdd(true)}>
            + Add subscriber
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState title="No subscribers found">
          {query || status !== 'all' ? 'Try clearing the search or status filter.' : 'Add someone or share the public sign-up page.'}
        </EmptyState>
      ) : (
        <div class="card">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Subscriber</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Added</th>
                  <th style="text-align:right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((subscriber) => (
                  <tr key={subscriber.id}>
                    <td>
                      <div style="font-weight:600">{subscriber.name || '—'}</div>
                      <div class="muted small">{subscriber.email}</div>
                    </td>
                    <td>
                      <select
                        class="select"
                        style="width:auto;padding:0.25rem 0.45rem;font-size:0.82rem"
                        value={subscriber.status}
                        disabled={busy}
                        onChange={(event) =>
                          void updateSubscriber(
                            subscriber,
                            { status: (event.target as HTMLSelectElement).value },
                            'Status updated',
                          )
                        }
                      >
                        <option value="active">Active</option>
                        <option value="pending">Pending</option>
                        <option value="unsubscribed">Unsubscribed</option>
                        <option value="bounced">Bounced</option>
                        <option value="complained">Complained</option>
                      </select>
                    </td>
                    <td>
                      <span class="badge badge-neutral">{subscriber.source}</span>
                    </td>
                    <td class="muted small">{formatDate(subscriber.createdAt)}</td>
                    <td>
                      <div class="row-tight" style="justify-content:flex-end">
                        {subscriber.status === 'pending' ? (
                          <button
                            type="button"
                            class="btn btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() => void updateSubscriber(subscriber, { resendConfirmation: true }, 'Confirmation email sent')}
                          >
                            Resend
                          </button>
                        ) : null}
                        <button type="button" class="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(subscriber)}>
                          Edit
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger)" disabled={busy} onClick={() => setDeleting(subscriber)}>
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="card-body" style="padding-top:0">
            <Pagination page={page} pageSize={pageSize} total={total} busy={busy} onPage={(next) => void load({ page: next })} />
          </div>
        </div>
      )}

      {showAdd ? (
        <Modal
          title="Add a subscriber"
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <button type="button" class="btn btn-secondary" onClick={() => setShowAdd(false)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="add-subscriber-form" class="btn" disabled={busy}>
                {busy ? <Spinner /> : null}
                Add subscriber
              </button>
            </>
          }
        >
          <form id="add-subscriber-form" onSubmit={addSubscriber}>
            <Field label="Email address" required>
              <input class="input" name="email" type="email" required placeholder="person@example.com" />
            </Field>
            <Field label="Name">
              <input class="input" name="name" maxLength={120} placeholder="Optional" />
            </Field>
            <Field label="Status">
              <select class="select" name="status" defaultValue={group.doubleOptIn ? 'pending' : 'active'}>
                <option value="active">Active immediately</option>
                <option value="pending">Require email confirmation</option>
              </select>
            </Field>
            <label class="checkbox">
              <input type="checkbox" name="sendWelcome" />
              <span>Send a welcome email if added as active</span>
            </label>
          </form>
        </Modal>
      ) : null}

      {showImport ? (
        <Modal
          title="Import subscribers"
          wide
          onClose={() => setShowImport(false)}
          footer={
            <>
              <button type="button" class="btn btn-secondary" onClick={() => setShowImport(false)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="import-subscribers-form" class="btn" disabled={busy}>
                {busy ? <Spinner /> : null}
                Import
              </button>
            </>
          }
        >
          <form id="import-subscribers-form" onSubmit={saveImport}>
            <Field
              label="CSV data"
              required
              hint={
                <>
                  Header row with <code>email</code> and optional <code>name</code> columns. Up to 1000 rows. Existing
                  addresses are updated, never duplicated.
                </>
              }
            >
              <textarea class="textarea" name="csv" required placeholder={'email,name\nada@example.com,Ada Lovelace\nlinus@example.com,Linus'} />
            </Field>
            <Field label="Import as">
              <select class="select" name="status" defaultValue={group.doubleOptIn ? 'pending' : 'active'}>
                <option value="pending">Pending — send confirmation emails</option>
                <option value="active">Active — skip confirmation (imported list)</option>
              </select>
            </Field>
            <label class="checkbox">
              <input type="checkbox" name="sendConfirmations" defaultChecked={group.doubleOptIn} />
              <span>Send confirmation emails to pending addresses</span>
            </label>
          </form>
        </Modal>
      ) : null}

      {editing ? (
        <Modal
          title="Edit subscriber"
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" class="btn btn-secondary" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="edit-subscriber-form" class="btn" disabled={busy}>
                {busy ? <Spinner /> : null}
                Save
              </button>
            </>
          }
        >
          <form
            id="edit-subscriber-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.target as HTMLFormElement);
              void updateSubscriber(editing, {
                email: data.get('email'),
                name: data.get('name'),
                status: data.get('status'),
              }, 'Subscriber updated').then(() => setEditing(null));
            }}
          >
            <Field label="Email address" required>
              <input class="input" name="email" type="email" required defaultValue={editing.email} />
            </Field>
            <Field label="Name">
              <input class="input" name="name" maxLength={120} defaultValue={editing.name ?? ''} />
            </Field>
            <Field label="Status">
              <select class="select" name="status" defaultValue={editing.status}>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="unsubscribed">Unsubscribed</option>
                <option value="bounced">Bounced</option>
                <option value="complained">Complained</option>
              </select>
            </Field>
          </form>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Remove subscriber"
          confirmLabel="Remove"
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void deleteSubscriber()}
        >
          <p>
            Remove <strong>{deleting.email}</strong> from this list? They can sign up again later.
          </p>
        </ConfirmDialog>
      ) : null}
      {host}
    </div>
  );
}
