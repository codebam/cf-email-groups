import { useState } from 'preact/hooks';
import { markdownToText, renderMarkdown } from '../lib/markdown';
import { personalize, SAMPLE_SUBSCRIBER } from '../lib/personalize';
import type { Campaign, GroupDetail, SessionUser } from '../lib/types';
import { api } from './api';
import { ConfirmDialog, EmptyState, Field, formatDateTime, Modal, type PushToast, Spinner, StatusBadge, useToasts } from './ui';

interface Props {
  user: SessionUser;
  group: GroupDetail;
  initial: Campaign[];
  push: PushToast;
}

interface SendProgress {
  status: string;
  total: number;
  sent: number;
  failed: number;
  remaining: number;
  done: boolean;
  error?: string;
}

export default function CampaignsTab({ user, group, initial, push }: Props) {
  const [campaigns, setCampaigns] = useState(initial);
  const [editorOpen, setEditorOpen] = useState(initial.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [subject, setSubject] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [preview, setPreview] = useState<'preview' | 'text'>('preview');
  const [saving, setSaving] = useState(false);
  const [confirmSend, setConfirmSend] = useState<Campaign | null>(null);
  const [sending, setSending] = useState<(SendProgress & { retry: boolean }) | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState(user.email ?? '');
  const { push: localPush, host } = useToasts();
  const notify: PushToast = (kind, message) => {
    push(kind, message);
    localPush(kind, message);
  };

  const upsert = (campaign: Campaign) => {
    setCampaigns((current) => {
      const exists = current.some((item) => item.id === campaign.id);
      return exists ? current.map((item) => (item.id === campaign.id ? campaign : item)) : [campaign, ...current];
    });
  };

  const openNew = () => {
    setEditingId(null);
    setSubject('');
    setBodyMd('');
    setPreview('preview');
    setEditorOpen(true);
  };

  const openEdit = (campaign: Campaign) => {
    setEditingId(campaign.id);
    setSubject(campaign.subject);
    setBodyMd(campaign.bodyMd);
    setPreview('preview');
    setEditorOpen(true);
  };

  const save = async (): Promise<Campaign | null> => {
    if (!subject.trim()) {
      notify('error', 'Add a subject line before saving.');
      return null;
    }
    setSaving(true);
    try {
      const result = editingId
        ? await api<{ campaign: Campaign }>(`/api/campaigns/${editingId}`, {
            method: 'PATCH',
            body: { subject, bodyMd },
          })
        : await api<{ campaign: Campaign }>(`/api/groups/${group.id}/campaigns`, {
            method: 'POST',
            body: { subject, bodyMd },
          });
      upsert(result.campaign);
      setEditingId(result.campaign.id);
      return result.campaign;
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not save the campaign.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async (event: Event) => {
    event.preventDefault();
    let campaignId = editingId;
    if (!campaignId) {
      const campaign = await save();
      if (!campaign) return;
      campaignId = campaign.id;
    }
    setSaving(true);
    try {
      await api(`/api/campaigns/${campaignId}/test`, { method: 'POST', body: { to: testTo, subject, bodyMd } });
      notify('success', `Test email sent to ${testTo}`);
      setTestOpen(false);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Test send failed.');
    } finally {
      setSaving(false);
    }
  };

  const startSend = async (campaign: Campaign, retry: boolean) => {
    setConfirmSend(null);
    setActiveCampaign(campaign);
    setSendError(null);
    setSending({
      status: campaign.status,
      total: campaign.total || group.counts.active,
      sent: campaign.sentCount,
      failed: campaign.failedCount,
      remaining: retry ? campaign.failedCount : campaign.total || group.counts.active,
      done: false,
      retry,
    });

    try {
      let done = false;
      let guard = 0;
      let last: SendProgress | null = null;
      while (!done && guard < 1000) {
        guard++;
        const progress = await api<SendProgress>(`/api/campaigns/${campaign.id}/send`, {
          method: 'POST',
          body: { batchSize: 25, retryFailed: retry },
        });
        last = progress;
        setSending({ ...progress, retry });
        upsert({ ...campaign, total: progress.total, sentCount: progress.sent, failedCount: progress.failed, status: progress.status as Campaign['status'], sentAt: progress.status === 'sent' ? new Date().toISOString() : campaign.sentAt });
        done = progress.done;
        if (!done && progress.error) {
          setSendError(progress.error);
          return;
        }
        if (!done) await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (done) {
        notify('success', last && last.failed > 0 ? `Sent with ${last.failed} failed deliveries.` : 'Campaign sent 🎉');
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Sending failed.');
    }
  };

  const deleteCampaign = async () => {
    if (!deleting) return;
    try {
      await api(`/api/campaigns/${deleting.id}`, { method: 'DELETE' });
      setCampaigns((current) => current.filter((item) => item.id !== deleting.id));
      notify('success', 'Campaign deleted');
      setDeleting(null);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not delete the campaign.');
    }
  };

  if (editorOpen) {
    return (
      <div>
        <div class="page-header" style="margin-bottom:0.75rem">
          <div class="grow">
            <h2 style="margin:0">{editingId ? 'Edit campaign' : 'New campaign'}</h2>
            <p class="muted small" style="margin:0">
              {'Markdown supported. Personalize with {{name}}, {{first_name}}, or {{email}}; previews use sample data. Subscribers each get a personal unsubscribe link.'}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost"
            onClick={() => {
              setEditorOpen(false);
              setEditingId(null);
            }}
          >
            ← Back to campaigns
          </button>
        </div>
        <div class="editor-grid">
          <div class="card card-body">
            <Field label="Subject" required hint="Merge tokens work here too: {{name}}, {{first_name}}, {{email}}.">
              <input
                class="input"
                value={subject}
                maxLength={200}
                onInput={(event) => setSubject((event.target as HTMLInputElement).value)}
                placeholder="What's the email about?"
              />
            </Field>
            <Field label="Body (Markdown)" hint="**bold**, *italic*, [links](https://…), # headings, lists, > quotes. Merge tokens: {{name}}, {{first_name}}, {{email}}.">
              <textarea
                class="textarea"
                style="min-height:340px"
                value={bodyMd}
                onInput={(event) => setBodyMd((event.target as HTMLTextAreaElement).value)}
                placeholder={'Hi {{name}},\n\nThis is **my first** campaign.\n\n[Read more](https://example.com)'}
              />
            </Field>
            <div class="row">
              <button type="button" class="btn btn-secondary" onClick={() => void save()} disabled={saving}>
                {saving ? <Spinner /> : null}
                Save draft
              </button>
              <button type="button" class="btn btn-secondary" onClick={() => setTestOpen(true)} disabled={saving}>
                Send test
              </button>
              <button type="button" class="btn" onClick={() => void save().then((c) => c && setConfirmSend(c))} disabled={saving || group.counts.active === 0}>
                Send to {group.counts.active} subscribers
              </button>
            </div>
          </div>
          <div>
            <div class="row" style="margin-bottom:0.5rem">
              <button type="button" class={`btn btn-sm ${preview === 'preview' ? '' : 'btn-secondary'}`} onClick={() => setPreview('preview')}>
                Preview
              </button>
              <button type="button" class={`btn btn-sm ${preview === 'text' ? '' : 'btn-secondary'}`} onClick={() => setPreview('text')}>
                Plain text
              </button>
            </div>
            {preview === 'preview' ? (
              <div class="preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(personalize(bodyMd, SAMPLE_SUBSCRIBER)) }} />
            ) : (
              <pre class="preview" style="white-space:pre-wrap">{markdownToText(personalize(bodyMd, SAMPLE_SUBSCRIBER))}</pre>
            )}
          </div>
        </div>

        {testOpen ? (
          <Modal
            title="Send a test"
            onClose={() => setTestOpen(false)}
            footer={
              <>
                <button type="button" class="btn btn-secondary" onClick={() => setTestOpen(false)} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" form="test-send-form" class="btn" disabled={saving}>
                  {saving ? <Spinner /> : null}
                  Send test
                </button>
              </>
            }
          >
            <form id="test-send-form" onSubmit={sendTest}>
              <Field label="Send test to" required hint="The latest saved draft is used, including unsaved edits. Tokens use sample subscriber data.">
                <input
                  class="input"
                  type="email"
                  required
                  value={testTo}
                  onInput={(event) => setTestTo((event.target as HTMLInputElement).value)}
                />
              </Field>
            </form>
          </Modal>
        ) : null}
        {host}
      </div>
    );
  }

  return (
    <div>
      <div class="toolbar">
        <p class="muted grow" style="margin:0">
          Campaigns are sent to <strong>{group.counts.active}</strong> active subscribers in small batches you can watch.
        </p>
        <button type="button" class="btn" onClick={openNew}>
          + New campaign
        </button>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          action={
            <button type="button" class="btn" onClick={openNew}>
              Write your first campaign
            </button>
          }
        >
          Compose in Markdown, preview it, send a test, then deliver to your list.
        </EmptyState>
      ) : (
        <div class="card card-body">
          {campaigns.map((campaign) => (
            <div key={campaign.id} class="campaign-row">
              <div class="grow" style="min-width:0">
                <div class="row-tight">
                  <strong class="truncate">{campaign.subject || '(no subject)'}</strong>
                  <StatusBadge status={campaign.status} />
                </div>
                <div class="muted small">
                  {campaign.status === 'sent' && campaign.sentAt
                    ? `Sent ${formatDateTime(campaign.sentAt)} · ${campaign.sentCount}/${campaign.total} delivered`
                    : campaign.status === 'sending'
                      ? `Sending… ${campaign.sentCount}/${campaign.total}`
                      : `Draft · created ${formatDateTime(campaign.createdAt)}`}
                  {campaign.failedCount > 0 ? ` · ${campaign.failedCount} failed` : ''}
                </div>
              </div>
              <div class="row-tight">
                {campaign.status === 'draft' ? (
                  <>
                    <button type="button" class="btn btn-secondary btn-sm" onClick={() => openEdit(campaign)}>
                      Edit
                    </button>
                    <button type="button" class="btn btn-sm" disabled={group.counts.active === 0} onClick={() => setConfirmSend(campaign)}>
                      Send
                    </button>
                  </>
                ) : null}
                {campaign.status === 'sent' && campaign.failedCount > 0 ? (
                  <button type="button" class="btn btn-secondary btn-sm" onClick={() => void startSend(campaign, true)}>
                    Retry failed
                  </button>
                ) : null}
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  onClick={() => {
                    setTestOpen(true);
                    setEditorOpen(true);
                    setEditingId(campaign.id);
                    setSubject(campaign.subject);
                    setBodyMd(campaign.bodyMd);
                  }}
                >
                  Test
                </button>
                <button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger)" onClick={() => setDeleting(campaign)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmSend ? (
        <ConfirmDialog
          title="Send campaign"
          confirmLabel={`Send to ${group.counts.active}`}
          onCancel={() => setConfirmSend(null)}
          onConfirm={() => void startSend(confirmSend, false)}
        >
          <p>
            Send <strong>{confirmSend.subject}</strong> to {group.counts.active} active subscribers?
          </p>
          <p class="muted small">Emails are delivered in batches. You can watch progress and it's safe to close this page.</p>
        </ConfirmDialog>
      ) : null}

      {sending ? (
        <Modal
          title={sending.done ? 'Campaign sent' : 'Sending campaign'}
          onClose={() => !sending.done && !sendError ? undefined : setSending(null)}
          footer={
            sending.done || sendError ? (
              <>
                {sending.failed > 0 && sending.done && activeCampaign ? (
                  <button type="button" class="btn btn-secondary" onClick={() => void startSend(activeCampaign, true)}>
                    Retry failed
                  </button>
                ) : null}
                {sendError && activeCampaign ? (
                  <button
                    type="button"
                    class="btn"
                    onClick={() => {
                      const retry = sending.retry;
                      setSendError(null);
                      void startSend(activeCampaign, retry);
                    }}
                  >
                    Retry
                  </button>
                ) : null}
                <button type="button" class="btn" onClick={() => setSending(null)}>
                  Close
                </button>
              </>
            ) : null
          }
        >
          <div class="stack">
            {sendError ? <div class="alert alert-error">{sendError}</div> : null}
            <div class="progress">
              <span style={`width:${sending.total ? Math.round(((sending.sent + sending.failed) / sending.total) * 100) : 0}%`} />
            </div>
            <div class="row small muted">
              <span>{sending.sent} delivered</span>
              {sending.failed ? <span>{sending.failed} failed</span> : null}
              <span class="right">{sending.total} total</span>
            </div>
            {sending.done ? <div class="alert alert-success">All done.</div> : <p class="muted small">Keep this tab open while it sends.</p>}
          </div>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog title="Delete campaign" confirmLabel="Delete" onCancel={() => setDeleting(null)} onConfirm={() => void deleteCampaign()}>
          <p>
            Delete <strong>{deleting.subject}</strong>? Delivery stats for this campaign are removed too.
          </p>
        </ConfirmDialog>
      ) : null}
      {host}
    </div>
  );
}
