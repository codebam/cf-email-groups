import { escapeHtml, excerpt, markdownToText, renderMarkdown } from './markdown';
import type { CampaignRow, GroupRow, SubscriberRow } from './types';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface GroupIdentity {
  name: string;
  fromName?: string;
  fromEmail?: string;
}

function layout(options: {
  groupName: string;
  preheader?: string;
  title?: string;
  body: string;
  footer?: string;
}): string {
  const header = options.title
    ? `<h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:#0f172a">${escapeHtml(options.title)}</h1>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(options.title ?? options.groupName)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
${options.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(options.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="padding:28px 32px 8px">
        <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-bottom:12px">${escapeHtml(options.groupName)}</div>
        ${header}
      </td></tr>
      <tr><td style="padding:8px 32px 28px;font-size:16px;line-height:1.6;color:#334155">
        ${options.body}
      </td></tr>
      <tr><td style="padding:16px 32px 28px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b">
        ${options.footer ?? ''}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#64748b">Or paste this link into your browser:<br><a href="${escapeHtml(url)}" style="color:#2563eb;word-break:break-all">${escapeHtml(url)}</a></p>`;
}

export function confirmEmail(options: {
  group: Pick<GroupRow, 'name'>;
  subscriber: Pick<SubscriberRow, 'email' | 'name'>;
  confirmUrl: string;
}): RenderedEmail {
  const greeting = options.subscriber.name ? `Hi ${escapeHtml(options.subscriber.name)},` : 'Hi there,';
  return {
    subject: `Confirm your subscription to ${options.group.name}`,
    html: layout({
      groupName: options.group.name,
      preheader: `One click to confirm ${options.subscriber.email}`,
      title: 'Confirm your subscription',
      body: `<p style="margin:0 0 16px">${greeting}</p>
<p style="margin:0 0 16px">Please confirm that you'd like to receive emails from <strong>${escapeHtml(options.group.name)}</strong> at <strong>${escapeHtml(options.subscriber.email)}</strong>.</p>
${button(options.confirmUrl, 'Confirm subscription')}
<p style="margin:0;font-size:13px;color:#64748b">If you didn't request this, you can safely ignore this email — you won't be subscribed.</p>`,
      footer: `You are receiving this because someone used this address to sign up for ${escapeHtml(options.group.name)}.`,
    }),
    text: `${greeting}\n\nPlease confirm your subscription to ${options.group.name} (${options.subscriber.email}):\n\n${options.confirmUrl}\n\nIf you didn't request this, ignore this email — you won't be subscribed.`,
  };
}

export function welcomeEmail(options: {
  group: Pick<GroupRow, 'name' | 'description'>;
  subscriber: Pick<SubscriberRow, 'email' | 'name'>;
  unsubscribeUrl: string;
}): RenderedEmail {
  const greeting = options.subscriber.name ? `Hi ${escapeHtml(options.subscriber.name)},` : 'Hi there,';
  return {
    subject: `You're subscribed to ${options.group.name}`,
    html: layout({
      groupName: options.group.name,
      preheader: 'Your subscription is confirmed.',
      title: "You're on the list",
      body: `<p style="margin:0 0 16px">${greeting}</p>
<p style="margin:0 0 16px">Your subscription to <strong>${escapeHtml(options.group.name)}</strong> is confirmed. You'll hear from us at <strong>${escapeHtml(options.subscriber.email)}</strong>.</p>
${options.group.description ? `<p style="margin:0 0 16px">${escapeHtml(options.group.description)}</p>` : ''}`,
      footer: `You can <a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#64748b">unsubscribe</a> at any time.`,
    }),
    text: `${greeting}\n\nYou're subscribed to ${options.group.name} (${options.subscriber.email}).\n\nUnsubscribe: ${options.unsubscribeUrl}`,
  };
}

export function campaignEmail(options: {
  group: Pick<GroupRow, 'name' | 'description'>;
  campaign: Pick<CampaignRow, 'subject' | 'body_md'>;
  subscriber: Pick<SubscriberRow, 'email' | 'name' | 'unsubscribe_token'>;
  unsubscribeUrl: string;
}): RenderedEmail {
  return {
    subject: options.campaign.subject,
    html: layout({
      groupName: options.group.name,
      preheader: excerpt(options.campaign.body_md),
      body: renderMarkdown(options.campaign.body_md),
      footer: `You're receiving this because you subscribed to ${escapeHtml(options.group.name)}.<br>
<a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#64748b">Unsubscribe</a> from these emails.`,
    }),
    text: `${markdownToText(options.campaign.body_md)}\n\n---\nYou're receiving this because you subscribed to ${options.group.name}.\nUnsubscribe: ${options.unsubscribeUrl}`,
  };
}

export function testEmail(options: {
  group: Pick<GroupRow, 'name'>;
  subject: string;
  bodyMd: string;
}): RenderedEmail {
  return {
    subject: `[Test] ${options.subject || '(no subject)'}`,
    html: layout({
      groupName: options.group.name,
      preheader: 'Test send from CF-Email-Groups',
      title: 'Test send',
      body: `<p style="margin:0 0 16px;color:#64748b;font-size:13px">This is a preview of a campaign for <strong>${escapeHtml(options.group.name)}</strong>. No subscribers received it.</p>${renderMarkdown(options.bodyMd)}`,
      footer: 'Sent from CF-Email-Groups.',
    }),
    text: `[Test] ${options.subject}\n\n${markdownToText(options.bodyMd)}`,
  };
}

export function groupIdentity(group: Pick<GroupRow, 'name' | 'from_name' | 'from_email'>): GroupIdentity {
  return { name: group.name, fromName: group.from_name || group.name, fromEmail: group.from_email };
}
