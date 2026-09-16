// Shared types used by both Worker code and Preact islands.
// Keep this module dependency-free so it is safe to import on the client.

export type GroupRole = 'owner' | 'admin';
export type SubscriberStatus = 'pending' | 'active' | 'unsubscribed' | 'bounced' | 'complained';
export type SubscriberSource = 'public' | 'admin' | 'import' | 'api';
export type CampaignStatus = 'draft' | 'sending' | 'sent' | 'failed';
export type EmailKind = 'confirm' | 'welcome' | 'campaign' | 'test' | 'admin_notice';
export type EmailStatus = 'queued' | 'sent' | 'failed';

/** A signed-in GitHub user. */
export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/** Row shapes straight out of D1. */
export interface UserRow {
  id: string;
  github_id: number;
  github_login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface GroupRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  from_name: string;
  from_email: string;
  reply_to: string;
  double_opt_in: number;
  public_signup: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriberRow {
  id: string;
  group_id: string;
  email: string;
  name: string | null;
  status: SubscriberStatus;
  source: SubscriberSource;
  confirm_token: string | null;
  confirm_sent_at: string | null;
  unsubscribe_token: string;
  created_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  updated_at: string;
}

export interface CampaignRow {
  id: string;
  group_id: string;
  subject: string;
  body_md: string;
  status: CampaignStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  sent_at: string | null;
  total: number;
  sent_count: number;
  failed_count: number;
  cursor: string | null;
}

export interface EmailOutboxRow {
  id: string;
  to_email: string;
  subject: string;
  html: string;
  text: string;
  kind: EmailKind;
  provider: string;
  provider_id: string | null;
  status: EmailStatus;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

/** API DTOs shared with the frontend. */
export interface GroupSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  role: GroupRole;
  totalCount: number;
  activeCount: number;
  pendingCount: number;
}

export interface GroupDetail {
  id: string;
  slug: string;
  name: string;
  description: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  doubleOptIn: boolean;
  publicSignup: boolean;
  role: GroupRole;
  createdAt: string;
  counts: Record<SubscriberStatus, number>;
}

export interface Subscriber {
  id: string;
  email: string;
  name: string | null;
  status: SubscriberStatus;
  source: SubscriberSource;
  createdAt: string;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
}

export interface Campaign {
  id: string;
  subject: string;
  bodyMd: string;
  status: CampaignStatus;
  createdAt: string;
  sentAt: string | null;
  total: number;
  sentCount: number;
  failedCount: number;
}

export interface GroupAdmin {
  userId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  role: GroupRole;
  pending: boolean;
}

export interface PublicGroup {
  name: string;
  slug: string;
  description: string;
  doubleOptIn: boolean;
  requiresTurnstile: boolean;
  turnstileSiteKey: string | null;
}

export function groupRoleAtLeast(role: GroupRole | null, needed: GroupRole): boolean {
  if (role === 'owner') return true;
  if (role === 'admin') return needed === 'admin';
  return false;
}

export function isActiveStatus(status: SubscriberStatus): boolean {
  return status === 'active';
}
