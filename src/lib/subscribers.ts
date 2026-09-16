import type { AppBindings } from './config';
import { execute, likePattern, queryAll, queryOne, type SqlValue } from './db';
import { normalizeEmail, toCsv, type ParsedSubscriberRow } from './csv';
import { sendEmail, sendEmailBatch, type EmailResult } from './email';
import { HttpError } from './http';
import { newId, randomToken } from './ids';
import { confirmEmail, welcomeEmail } from './templates';
import type { GroupRow, Subscriber, SubscriberRow, SubscriberSource, SubscriberStatus } from './types';

export function rowToSubscriber(row: SubscriberRow): Subscriber {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    unsubscribedAt: row.unsubscribed_at,
  };
}

/** Human-facing page link used in email footers. */
export function unsubscribeUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** RFC 8058 one-click POST endpoint used in List-Unsubscribe headers. */
export function unsubscribeApiUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/api/public/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function confirmUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/confirm?token=${encodeURIComponent(token)}`;
}

export interface ListSubscribersOptions {
  status?: SubscriberStatus | 'all';
  query?: string;
  page: number;
  pageSize: number;
}

export async function listSubscribers(
  db: D1Database,
  groupId: string,
  options: ListSubscribersOptions,
): Promise<{ subscribers: Subscriber[]; total: number; page: number; pageSize: number }> {
  const where: string[] = ['group_id = ?'];
  const params: SqlValue[] = [groupId];
  if (options.status && options.status !== 'all') {
    where.push('status = ?');
    params.push(options.status);
  }
  if (options.query) {
    const pattern = likePattern(options.query);
    where.push("(email LIKE ? ESCAPE '\\' OR COALESCE(name, '') LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  const whereSql = where.join(' AND ');
  const totalRow = await queryOne<{ count: number }>(db, `SELECT COUNT(*) AS count FROM subscribers WHERE ${whereSql}`, ...params);
  const rows = await queryAll<SubscriberRow>(
    db,
    `SELECT * FROM subscribers WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    options.pageSize,
    (options.page - 1) * options.pageSize,
  );
  return {
    subscribers: rows.map(rowToSubscriber),
    total: Number(totalRow?.count ?? 0),
    page: options.page,
    pageSize: options.pageSize,
  };
}

export async function getSubscriber(db: D1Database, groupId: string, id: string): Promise<SubscriberRow | null> {
  return queryOne<SubscriberRow>(db, 'SELECT * FROM subscribers WHERE group_id = ? AND id = ?', groupId, id);
}

export async function findSubscriberByEmail(
  db: D1Database,
  groupId: string,
  email: string,
): Promise<SubscriberRow | null> {
  return queryOne<SubscriberRow>(db, 'SELECT * FROM subscribers WHERE group_id = ? AND email = ? COLLATE NOCASE', groupId, email);
}

async function sendConfirmEmailFor(
  env: AppBindings,
  db: D1Database,
  group: GroupRow,
  subscriber: SubscriberRow,
  appUrl: string,
): Promise<EmailResult> {
  const rendered = confirmEmail({
    group,
    subscriber,
    confirmUrl: confirmUrl(appUrl, subscriber.confirm_token!),
  });
  return sendEmail(env, db, {
    to: subscriber.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    kind: 'confirm',
    fromName: group.from_name || group.name,
    fromEmail: group.from_email || undefined,
    replyTo: group.reply_to || undefined,
    listUnsubscribeUrl: unsubscribeApiUrl(appUrl, subscriber.unsubscribe_token),
  });
}

async function sendWelcomeEmailFor(
  env: AppBindings,
  db: D1Database,
  group: GroupRow,
  subscriber: SubscriberRow,
  appUrl: string,
): Promise<EmailResult> {
  const unsubscribe = unsubscribeUrl(appUrl, subscriber.unsubscribe_token);
  const rendered = welcomeEmail({ group, subscriber, unsubscribeUrl: unsubscribe });
  return sendEmail(env, db, {
    to: subscriber.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    kind: 'welcome',
    fromName: group.from_name || group.name,
    fromEmail: group.from_email || undefined,
    replyTo: group.reply_to || undefined,
    listUnsubscribeUrl: unsubscribeApiUrl(appUrl, subscriber.unsubscribe_token),
  });
}

export async function resendConfirmation(
  env: AppBindings,
  db: D1Database,
  group: GroupRow,
  subscriber: SubscriberRow,
  appUrl: string,
): Promise<EmailResult> {
  if (subscriber.status !== 'pending') throw new HttpError(400, 'That subscriber is not pending confirmation.');
  let token = subscriber.confirm_token;
  if (!token) {
    token = randomToken(24);
    await execute(
      db,
      'UPDATE subscribers SET confirm_token = ?, updated_at = ? WHERE id = ?',
      token,
      new Date().toISOString(),
      subscriber.id,
    );
    subscriber = { ...subscriber, confirm_token: token };
  }
  const result = await sendConfirmEmailFor(env, db, group, subscriber, appUrl);
  if (result.status === 'sent') {
    await execute(db, 'UPDATE subscribers SET confirm_sent_at = ? WHERE id = ?', new Date().toISOString(), subscriber.id);
  }
  return result;
}

export interface AddSubscriberInput {
  email: string;
  name?: string | null;
  status: 'active' | 'pending';
  source: SubscriberSource;
  sendWelcome?: boolean;
  suppressEmail?: boolean;
}

export interface AddSubscriberResult {
  subscriber: SubscriberRow;
  existed: boolean;
  emailResult?: EmailResult;
}

export async function addSubscriber(
  env: AppBindings,
  db: D1Database,
  group: GroupRow,
  input: AddSubscriberInput,
  appUrl: string,
): Promise<AddSubscriberResult> {
  const email = normalizeEmail(input.email);
  if (!email) throw new HttpError(400, 'Enter a valid email address.');
  const name = input.name?.trim() ? input.name.trim().slice(0, 120) : null;
  const now = new Date().toISOString();
  const existing = await findSubscriberByEmail(db, group.id, email);

  if (existing) {
    const patchName = name && name !== existing.name ? name : existing.name;

    if (input.status === 'pending') {
      let subscriber = existing;
      if (existing.status !== 'pending') {
        const token = randomToken(24);
        await execute(
          db,
          `UPDATE subscribers SET status = 'pending', name = ?, confirm_token = ?, confirm_sent_at = NULL,
             confirmed_at = NULL, unsubscribed_at = NULL, updated_at = ? WHERE id = ?`,
          patchName,
          token,
          now,
          existing.id,
        );
        subscriber = { ...existing, status: 'pending', name: patchName, confirm_token: token, confirmed_at: null, unsubscribed_at: null };
      } else if (patchName !== existing.name || !existing.confirm_token) {
        const token = existing.confirm_token ?? randomToken(24);
        await execute(
          db,
          'UPDATE subscribers SET name = ?, confirm_token = ?, updated_at = ? WHERE id = ?',
          patchName,
          token,
          now,
          existing.id,
        );
        subscriber = { ...existing, name: patchName, confirm_token: token };
      }
      const emailResult = input.suppressEmail
        ? undefined
        : await sendConfirmEmailFor(env, db, group, subscriber, appUrl);
      if (emailResult?.status === 'sent') {
        await execute(db, 'UPDATE subscribers SET confirm_sent_at = ? WHERE id = ?', now, subscriber.id);
      }
      return { subscriber, existed: true, emailResult };
    }

    await execute(
      db,
      `UPDATE subscribers SET status = 'active', name = ?,
         confirmed_at = COALESCE(confirmed_at, ?), unsubscribed_at = NULL, confirm_token = NULL, updated_at = ?
       WHERE id = ?`,
      patchName,
      now,
      now,
      existing.id,
    );
    const subscriber: SubscriberRow = {
      ...existing,
      status: 'active',
      name: patchName,
      confirmed_at: existing.confirmed_at ?? now,
      unsubscribed_at: null,
      confirm_token: null,
      updated_at: now,
    };
    const emailResult =
      input.suppressEmail || !input.sendWelcome ? undefined : await sendWelcomeEmailFor(env, db, group, subscriber, appUrl);
    return { subscriber, existed: true, emailResult };
  }

  const id = newId();
  const confirmToken = input.status === 'pending' ? randomToken(24) : null;
  const unsubscribeToken = randomToken(24);
  await execute(
    db,
    `INSERT INTO subscribers (id, group_id, email, name, status, source, confirm_token, confirm_sent_at,
       unsubscribe_token, created_at, confirmed_at, unsubscribed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?)`,
    id,
    group.id,
    email,
    name,
    input.status,
    input.source,
    confirmToken,
    unsubscribeToken,
    now,
    input.status === 'active' ? now : null,
    now,
  );
  const subscriber: SubscriberRow = {
    id,
    group_id: group.id,
    email,
    name,
    status: input.status,
    source: input.source,
    confirm_token: confirmToken,
    confirm_sent_at: null,
    unsubscribe_token: unsubscribeToken,
    created_at: now,
    confirmed_at: input.status === 'active' ? now : null,
    unsubscribed_at: null,
    updated_at: now,
  };

  let emailResult: EmailResult | undefined;
  if (!input.suppressEmail) {
    if (input.status === 'pending') {
      emailResult = await sendConfirmEmailFor(env, db, group, subscriber, appUrl);
      if (emailResult.status === 'sent') {
        await execute(db, 'UPDATE subscribers SET confirm_sent_at = ? WHERE id = ?', now, id);
      }
    } else if (input.sendWelcome) {
      emailResult = await sendWelcomeEmailFor(env, db, group, subscriber, appUrl);
    }
  }
  return { subscriber, existed: false, emailResult };
}

export interface ConfirmResult {
  ok: boolean;
  reason?: 'invalid' | 'unsubscribed';
  groupSlug?: string;
  groupName?: string;
  emailResult?: EmailResult;
}

export async function confirmSubscriber(
  env: AppBindings,
  db: D1Database,
  token: string,
  appUrl: string,
): Promise<ConfirmResult> {
  const row = await queryOne<SubscriberRow & { group_slug: string; group_name: string }>(
    db,
    `SELECT s.*, g.slug AS group_slug, g.name AS group_name
       FROM subscribers s JOIN groups g ON g.id = s.group_id
      WHERE s.confirm_token = ?`,
    token,
  );
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.status === 'unsubscribed' || row.status === 'bounced' || row.status === 'complained') {
    return { ok: false, reason: 'unsubscribed', groupSlug: row.group_slug, groupName: row.group_name };
  }
  if (row.status === 'active') {
    return { ok: true, groupSlug: row.group_slug, groupName: row.group_name };
  }

  const now = new Date().toISOString();
  await execute(
    db,
    `UPDATE subscribers SET status = 'active', confirmed_at = COALESCE(confirmed_at, ?),
       unsubscribed_at = NULL, updated_at = ? WHERE id = ?`,
    now,
    now,
    row.id,
  );
  const subscriber: SubscriberRow = { ...row, status: 'active', confirmed_at: now, unsubscribed_at: null, updated_at: now };
  const group = await queryOne<GroupRow>(db, 'SELECT * FROM groups WHERE id = ?', row.group_id);
  const emailResult = group ? await sendWelcomeEmailFor(env, db, group, subscriber, appUrl) : undefined;
  return { ok: true, groupSlug: row.group_slug, groupName: row.group_name, emailResult };
}

export interface UnsubscribeResult {
  ok: boolean;
  reason?: 'invalid';
  already?: boolean;
  groupSlug?: string;
  groupName?: string;
}

export async function unsubscribeByToken(db: D1Database, token: string): Promise<UnsubscribeResult> {
  const row = await queryOne<SubscriberRow & { group_slug: string; group_name: string }>(
    db,
    `SELECT s.*, g.slug AS group_slug, g.name AS group_name
       FROM subscribers s JOIN groups g ON g.id = s.group_id
      WHERE s.unsubscribe_token = ?`,
    token,
  );
  if (!row) return { ok: false, reason: 'invalid' };
  const already = row.status === 'unsubscribed';
  if (!already) {
    await execute(
      db,
      `UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ?, updated_at = ? WHERE id = ?`,
      new Date().toISOString(),
      new Date().toISOString(),
      row.id,
    );
  }
  return { ok: true, already, groupSlug: row.group_slug, groupName: row.group_name };
}

export interface UpdateSubscriberInput {
  name?: string | null;
  email?: string;
  status?: SubscriberStatus;
  resendConfirmation?: boolean;
}

export async function updateSubscriber(
  env: AppBindings,
  db: D1Database,
  group: GroupRow,
  subscriber: SubscriberRow,
  input: UpdateSubscriberInput,
  appUrl: string,
): Promise<{ subscriber: SubscriberRow; emailResult?: EmailResult }> {
  const now = new Date().toISOString();
  const fields: string[] = [];
  const values: SqlValue[] = [];
  const set = (column: string, value: SqlValue) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };

  if (input.name !== undefined) set('name', input.name?.trim() ? input.name.trim().slice(0, 120) : null);
  if (input.email !== undefined) {
    const email = normalizeEmail(input.email);
    if (!email) throw new HttpError(400, 'Enter a valid email address.');
    if (email !== subscriber.email) {
      const duplicate = await findSubscriberByEmail(db, group.id, email);
      if (duplicate && duplicate.id !== subscriber.id) throw new HttpError(409, 'That email is already on this list.');
      set('email', email);
    }
  }
  if (input.status !== undefined) {
    if (!VALID_STATUSES.includes(input.status)) throw new HttpError(400, 'Unknown subscriber status.');
    set('status', input.status);
    if (input.status === 'active') {
      set('confirmed_at', subscriber.confirmed_at ?? now);
      set('unsubscribed_at', null);
      set('confirm_token', null);
    } else if (input.status === 'pending') {
      set('confirm_token', subscriber.confirm_token ?? randomToken(24));
      set('confirmed_at', null);
      set('unsubscribed_at', null);
    } else if (input.status === 'unsubscribed') {
      set('unsubscribed_at', now);
    }
  }
  if (fields.length === 0 && !input.resendConfirmation) return { subscriber };
  set('updated_at', now);
  values.push(subscriber.id);
  await execute(db, `UPDATE subscribers SET ${fields.join(', ')} WHERE id = ?`, ...values);
  let updated = (await getSubscriber(db, group.id, subscriber.id))!;

  let emailResult: EmailResult | undefined;
  if (input.resendConfirmation) emailResult = await resendConfirmation(env, db, group, updated, appUrl);
  else if (input.status === 'pending' && updated.status === 'pending') {
    emailResult = await resendConfirmation(env, db, group, updated, appUrl);
  }
  if (input.status === 'active' && subscriber.status !== 'active') {
    emailResult = emailResult ?? (await sendWelcomeEmailFor(env, db, group, updated, appUrl));
  }
  updated = (await getSubscriber(db, group.id, subscriber.id))!;
  return { subscriber: updated, emailResult };
}

export async function removeSubscriber(db: D1Database, groupId: string, id: string): Promise<void> {
  await execute(db, 'DELETE FROM subscribers WHERE group_id = ? AND id = ?', groupId, id);
}

export interface ImportResult {
  created: number;
  updated: number;
  invalid: number;
  emailed: number;
  failedEmails: number;
}

export async function importSubscribers(
  env: AppBindings,
  db: D1Database,
  group: GroupRow,
  rows: ParsedSubscriberRow[],
  options: { status: 'active' | 'pending'; sendConfirmations: boolean },
  appUrl: string,
): Promise<ImportResult> {
  if (rows.length > 1000) throw new HttpError(400, 'Imports are limited to 1000 rows at a time.');
  const result: ImportResult = { created: 0, updated: 0, invalid: 0, emailed: 0, failedEmails: 0 };
  const pendingToNotify: SubscriberRow[] = [];

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) {
      result.invalid++;
      continue;
    }
    try {
      const added = await addSubscriber(
        env,
        db,
        group,
        { email, name: row.name, status: options.status, source: 'import', suppressEmail: true },
        appUrl,
      );
      if (added.existed) result.updated++;
      else result.created++;
      if (options.sendConfirmations && added.subscriber.status === 'pending') pendingToNotify.push(added.subscriber);
    } catch (error) {
      if (error instanceof HttpError && error.status === 400) result.invalid++;
      else throw error;
    }
  }

  if (pendingToNotify.length > 0) {
    const messages = pendingToNotify.map((subscriber) => {
      const rendered = confirmEmail({
        group,
        subscriber,
        confirmUrl: confirmUrl(appUrl, subscriber.confirm_token!),
      });
      return {
        to: subscriber.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        kind: 'confirm' as const,
        fromName: group.from_name || group.name,
        fromEmail: group.from_email || undefined,
        replyTo: group.reply_to || undefined,
        listUnsubscribeUrl: unsubscribeApiUrl(appUrl, subscriber.unsubscribe_token),
      };
    });
    const results = await sendEmailBatch(env, db, messages);
    result.emailed = results.filter((r) => r.status === 'sent').length;
    result.failedEmails = results.filter((r) => r.status === 'failed').length;
    const now = new Date().toISOString();
    const updates = pendingToNotify
      .map((subscriber, index) => ({ subscriber, result: results[index] }))
      .filter((item) => item.result?.status === 'sent')
      .map((item) =>
        db.prepare('UPDATE subscribers SET confirm_sent_at = ? WHERE id = ?').bind(now, item.subscriber.id),
      );
    if (updates.length > 0) await db.batch(updates);
  }

  return result;
}

export async function exportSubscribersCsv(db: D1Database, groupId: string): Promise<string> {
  const rows = await queryAll<SubscriberRow>(
    db,
    'SELECT * FROM subscribers WHERE group_id = ? ORDER BY created_at ASC',
    groupId,
  );
  const header = ['email', 'name', 'status', 'source', 'created_at', 'confirmed_at', 'unsubscribed_at'];
  const data = rows.map((row) => [
    row.email,
    row.name,
    row.status,
    row.source,
    row.created_at,
    row.confirmed_at,
    row.unsubscribed_at,
  ]);
  return toCsv([header, ...data]);
}

const VALID_STATUSES: SubscriberStatus[] = ['pending', 'active', 'unsubscribed', 'bounced', 'complained'];
