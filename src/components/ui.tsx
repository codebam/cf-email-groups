import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

let toastId = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = (kind: Toast['kind'], message: string) => {
    const id = ++toastId;
    setToasts((current) => [...current, { id, kind, message }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 5000);
  };

  const host = (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} class={`toast toast-${toast.kind === 'info' ? 'success' : toast.kind}`}>
          <span class="grow">{toast.message}</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            aria-label="Dismiss"
            onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );

  return { push, host };
}

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  return (
    <div
      class="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div class="modal" role="dialog" aria-modal="true" aria-label={props.title} style={props.wide ? 'max-width:760px' : undefined}>
        <div class="modal-header">
          <h2 class="grow">{props.title}</h2>
          <button type="button" class="btn btn-ghost btn-icon" aria-label="Close" onClick={props.onClose}>
            ×
          </button>
        </div>
        <div class="modal-body">{props.children}</div>
        {props.footer ? <div class="modal-footer">{props.footer}</div> : null}
      </div>
    </div>
  );
}

export function Field(props: { label: string; hint?: ComponentChildren; children: ComponentChildren; required?: boolean }) {
  return (
    <div class="field">
      <label>
        {props.label}
        {props.required ? ' *' : ''}
      </label>
      {props.children}
      {props.hint ? <span class="hint">{props.hint}</span> : null}
    </div>
  );
}

export function Spinner() {
  return <span class="spinner" aria-hidden="true" />;
}

export function StatusBadge(props: { status: string }) {
  const label = props.status.charAt(0).toUpperCase() + props.status.slice(1);
  return <span class={`badge badge-${props.status}`}>{label}</span>;
}

export function RoleBadge(props: { role: string; pending?: boolean }) {
  if (props.pending) return <span class="badge badge-pending">Invited</span>;
  return <span class={`badge ${props.role === 'owner' ? 'badge-owner' : 'badge-neutral'}`}>{props.role === 'owner' ? 'Owner' : 'Admin'}</span>;
}

export function EmptyState(props: { title: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="empty">
      <h3>{props.title}</h3>
      {props.children ? <p class="muted small">{props.children}</p> : null}
      {props.action}
    </div>
  );
}

export function Pagination(props: { page: number; pageSize: number; total: number; onPage: (page: number) => void; busy?: boolean }) {
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize));
  if (pages <= 1) return null;
  return (
    <div class="row small" style="justify-content:flex-end;margin-top:0.75rem">
      <span class="muted">
        Page {props.page} of {pages} · {props.total} total
      </span>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        disabled={props.busy || props.page <= 1}
        onClick={() => props.onPage(props.page - 1)}
      >
        Previous
      </button>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        disabled={props.busy || props.page >= pages}
        onClick={() => props.onPage(props.page + 1)}
      >
        Next
      </button>
    </div>
  );
}

export function ConfirmDialog(props: {
  title: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ComponentChildren;
}) {
  return (
    <Modal
      title={props.title}
      onClose={props.onCancel}
      footer={
        <>
          <button type="button" class="btn btn-secondary" onClick={props.onCancel} disabled={props.busy}>
            Cancel
          </button>
          <button type="button" class="btn btn-danger" onClick={props.onConfirm} disabled={props.busy}>
            {props.busy ? <Spinner /> : null}
            {props.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      {props.children}
    </Modal>
  );
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export type PushToast = (kind: 'success' | 'error' | 'info', message: string) => void;
