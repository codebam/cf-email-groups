import type { Campaign } from '../lib/types';
import { ConfirmDialog, Modal } from './ui';

/** Progress shape returned by the campaign send endpoint. */
export interface CampaignSendProgress {
  status: string;
  total: number;
  sent: number;
  failed: number;
  remaining: number;
  done: boolean;
  retry: boolean;
}

export function CampaignConfirmDialog(props: {
  campaign: Campaign;
  activeCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      title="Send campaign"
      confirmLabel={`Send to ${props.activeCount}`}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    >
      <p>
        Send <strong>{props.campaign.subject}</strong> to {props.activeCount} active subscribers?
      </p>
      <p class="muted small">Emails are delivered in batches. You can watch progress and it's safe to close this page.</p>
    </ConfirmDialog>
  );
}

export function CampaignProgressDialog(props: {
  sending: CampaignSendProgress;
  sendError: string | null;
  activeCampaign: Campaign | null;
  onRetry: (retry: boolean) => void;
  onClose: () => void;
}) {
  const { sending, sendError, activeCampaign, onRetry, onClose } = props;
  return (
    <Modal
      title={sending.done ? 'Campaign sent' : 'Sending campaign'}
      onClose={() => (!sending.done && !sendError ? undefined : onClose())}
      footer={
        sending.done || sendError ? (
          <>
            {sending.failed > 0 && sending.done && activeCampaign ? (
              <button type="button" class="btn btn-secondary" onClick={() => onRetry(true)}>
                Retry failed
              </button>
            ) : null}
            {sendError && activeCampaign ? (
              <button type="button" class="btn" onClick={() => onRetry(sending.retry)}>
                Retry
              </button>
            ) : null}
            <button type="button" class="btn" onClick={onClose}>
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
  );
}
