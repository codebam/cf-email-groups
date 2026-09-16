import type { AppBindings } from './config';
import { execute, queryAll, queryOne } from './db';
import { sendEmail, sendEmailBatch, type OutboundEmail } from './email';
import { HttpError } from './http';
import { newId } from './ids';
import { campaignEmail, testEmail } from './templates';
import { unsubscribeApiUrl, unsubscribeUrl } from './subscribers';
import { requireMembership } from './groups';
import type { Campaign, CampaignRow, CampaignStatus, GroupRole, GroupRow, SessionUser, SubscriberRow } from './types';

export function rowToCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    subject: row.subject,
    bodyMd: row.body_md,
    status: row.status,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    total: row.total,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
  };
}

export async function getCampaign(db: D1Database, id: string): Promise<CampaignRow | null> {
  return queryOne<CampaignRow>(db, 'SELECT * FROM campaigns WHERE id = ?', id);
}

export async function listCampaigns(db: D1Database, groupId: string, limit = 50): Promise<Campaign[]> {
  const rows = await queryAll<CampaignRow>(
    db,
    'SELECT * FROM campaigns WHERE group_id = ? ORDER BY created_at DESC LIMIT ?',
    groupId,
    Math.min(200, Math.max(1, limit)),
  );
  return rows.map(rowToCampaign);
}

export interface CampaignInput {
  subject: string;
  bodyMd: string;
}

function validateCampaignInput(input: CampaignInput): { subject: string; bodyMd: string } {
  const subject = input.subject.replace(/[\r\n]+/g, ' ').trim();
  if (!subject) throw new HttpError(400, 'Add a subject line before saving.');
  if (subject.length > 200) throw new HttpError(400, 'Subject lines are limited to 200 characters.');
  const bodyMd = input.bodyMd.replace(/\u0000/g, '');
  if (bodyMd.length > 200_000) throw new HttpError(400, 'The email body is too long.');
  return { subject, bodyMd };
}

export async function createCampaign(
  db: D1Database,
  group: GroupRow,
  user: SessionUser,
  input: CampaignInput,
): Promise<CampaignRow> {
  const { subject, bodyMd } = validateCampaignInput(input);
  const now = new Date().toISOString();
  const id = newId();
  await execute(
    db,
    `INSERT INTO campaigns (id, group_id, subject, body_md, status, created_by, created_at, updated_at, total, sent_count, failed_count)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, 0, 0, 0)`,
    id,
    group.id,
    subject,
    bodyMd,
    user.id,
    now,
    now,
  );
  const campaign = await getCampaign(db, id);
  if (!campaign) throw new Error('Failed to create campaign');
  return campaign;
}

export async function updateCampaign(db: D1Database, campaign: CampaignRow, input: CampaignInput): Promise<CampaignRow> {
  if (campaign.status === 'sending') throw new HttpError(409, 'This campaign is currently sending.');
  const { subject, bodyMd } = validateCampaignInput(input);
  await execute(
    db,
    `UPDATE campaigns SET subject = ?, body_md = ?, status = 'draft', updated_at = ? WHERE id = ?`,
    subject,
    bodyMd,
    new Date().toISOString(),
    campaign.id,
  );
  const updated = await getCampaign(db, campaign.id);
  if (!updated) throw new HttpError(404, 'Campaign not found.');
  return updated;
}

export async function deleteCampaign(db: D1Database, campaign: CampaignRow): Promise<void> {
  if (campaign.status === 'sending') throw new HttpError(409, 'This campaign is currently sending.');
  await execute(db, 'DELETE FROM campaigns WHERE id = ?', campaign.id);
}

export async function sendTestCampaign(
  env: AppBindings,
  db: D1Database,
  group: GroupRow,
  input: CampaignInput,
  to: string,
): Promise<{ ok: boolean; error?: string }> {
  const { subject, bodyMd } = validateCampaignInput(input);
  const rendered = testEmail({ group, subject, bodyMd });
  const result = await sendEmail(env, db, {
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    kind: 'test',
    fromName: group.from_name || group.name,
    fromEmail: group.from_email || undefined,
    replyTo: group.reply_to || undefined,
  });
  return result.status === 'sent' ? { ok: true } : { ok: false, error: result.error };
}

export interface SendProgress {
  status: CampaignStatus;
  total: number;
  sent: number;
  failed: number;
  remaining: number;
  done: boolean;
  error?: string;
}

async function activeCount(db: D1Database, groupId: string, afterId: string | null): Promise<number> {
  const row = afterId
    ? await queryOne<{ count: number }>(
        db,
        "SELECT COUNT(*) AS count FROM subscribers WHERE group_id = ? AND status = 'active' AND id > ?",
        groupId,
        afterId,
      )
    : await queryOne<{ count: number }>(
        db,
        "SELECT COUNT(*) AS count FROM subscribers WHERE group_id = ? AND status = 'active'",
        groupId,
      );
  return Number(row?.count ?? 0);
}

async function sendCounts(db: D1Database, campaignId: string): Promise<{ sent: number; failed: number }> {
  const row = await queryOne<{ sent: number; failed: number }>(
    db,
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
       COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
     FROM campaign_sends WHERE campaign_id = ?`,
    campaignId,
  );
  return { sent: Number(row?.sent ?? 0), failed: Number(row?.failed ?? 0) };
}

export interface SendCampaignOptions {
  batchSize: number;
  retryFailed: boolean;
  appUrl: string;
}

/**
 * Sends one batch and returns progress. Call repeatedly until `done` is true.
 * Batches keep each Worker invocation inside subrequest/CPU limits.
 */
export async function sendCampaignBatch(
  env: AppBindings,
  db: D1Database,
  group: GroupRow,
  campaignInput: CampaignRow,
  options: SendCampaignOptions,
): Promise<SendProgress> {
  let campaign = campaignInput;
  const batchSize = Math.min(100, Math.max(1, options.batchSize));

  if (campaign.status === 'draft') {
    const total = await activeCount(db, group.id, null);
    const now = new Date().toISOString();
    // Atomic claim: only one concurrent sender may move draft -> sending.
    const claim = await db
      .prepare(
        `UPDATE campaigns SET status = 'sending', total = ?, sent_count = 0, failed_count = 0,
           cursor = NULL, started_at = ?, updated_at = ?, sent_at = NULL
         WHERE id = ? AND status = 'draft'`,
      )
      .bind(total, now, now, campaign.id)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) {
      const latest = await getCampaign(db, campaign.id);
      if (!latest) throw new HttpError(404, 'Campaign not found.');
      campaign = latest;
    } else {
      campaign = { ...campaign, status: 'sending', total, sent_count: 0, failed_count: 0, cursor: null, started_at: now, sent_at: null };
      if (total === 0) {
        await execute(db, "UPDATE campaigns SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?", now, now, campaign.id);
        return { status: 'sent', total: 0, sent: 0, failed: 0, remaining: 0, done: true };
      }
    }
  }

  if (campaign.status === 'sent' && !options.retryFailed) {
    const counts = await sendCounts(db, campaign.id);
    return { status: 'sent', total: campaign.total, sent: counts.sent, failed: counts.failed, remaining: 0, done: true };
  }

  let recipients: SubscriberRow[];
  if (options.retryFailed && (campaign.status === 'sent' || campaign.status === 'sending')) {
    recipients = await queryAll<SubscriberRow>(
      db,
      `SELECT s.* FROM campaign_sends cs JOIN subscribers s ON s.id = cs.subscriber_id
        WHERE cs.campaign_id = ? AND cs.status = 'failed' AND s.status = 'active'
        ORDER BY s.id LIMIT ?`,
      campaign.id,
      batchSize,
    );
    if (recipients.length === 0) {
      const counts = await sendCounts(db, campaign.id);
      const now = new Date().toISOString();
      await execute(db, "UPDATE campaigns SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?", now, now, campaign.id);
      return { status: 'sent', total: campaign.total, sent: counts.sent, failed: 0, remaining: 0, done: true };
    }
  } else {
    recipients = await queryAll<SubscriberRow>(
      db,
      `SELECT * FROM subscribers WHERE group_id = ? AND status = 'active' AND id > COALESCE(?, '')
       ORDER BY id LIMIT ?`,
      group.id,
      campaign.cursor,
      batchSize,
    );
  }

  if (recipients.length === 0) {
    const counts = await sendCounts(db, campaign.id);
    const now = new Date().toISOString();
    const remaining = await activeCount(db, group.id, campaign.cursor);
    await execute(
      db,
      "UPDATE campaigns SET status = 'sent', sent_count = ?, failed_count = ?, sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?",
      counts.sent,
      counts.failed,
      now,
      now,
      campaign.id,
    );
    return { status: 'sent', total: campaign.total, sent: counts.sent, failed: counts.failed, remaining, done: true };
  }

  const messages: OutboundEmail[] = recipients.map((subscriber) => {
    const unsubscribe = unsubscribeUrl(options.appUrl, subscriber.unsubscribe_token);
    const rendered = campaignEmail({ group, campaign, subscriber, unsubscribeUrl: unsubscribe });
    return {
      to: subscriber.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'campaign',
      fromName: group.from_name || group.name,
      fromEmail: group.from_email || undefined,
      replyTo: group.reply_to || undefined,
      listUnsubscribeUrl: unsubscribeApiUrl(options.appUrl, subscriber.unsubscribe_token),
    };
  });

  const results = await sendEmailBatch(env, db, messages);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = recipients.map((subscriber, index) => {
    const result = results[index]!;
    return db
      .prepare(
        `INSERT INTO campaign_sends (id, campaign_id, subscriber_id, status, provider_id, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id, subscriber_id) DO UPDATE SET
           status = excluded.status, provider_id = excluded.provider_id,
           error = excluded.error, created_at = excluded.created_at`,
      )
      .bind(
        newId(),
        campaign.id,
        subscriber.id,
        result.status,
        result.providerId ?? null,
        result.error ?? null,
        now,
      );
  });
  if (statements.length > 0) await db.batch(statements);

  const anySent = results.some((result) => result.status === 'sent');
  let cursor = campaign.cursor;
  if (!options.retryFailed && anySent) {
    cursor = recipients[recipients.length - 1]!.id;
  }
  if (options.retryFailed) {
    cursor = campaign.cursor;
  }

  const counts = await sendCounts(db, campaign.id);
  let remaining: number;
  if (options.retryFailed) {
    const row = await queryOne<{ count: number }>(
      db,
      "SELECT COUNT(*) AS count FROM campaign_sends WHERE campaign_id = ? AND status = 'failed'",
      campaign.id,
    );
    remaining = Number(row?.count ?? 0);
  } else {
    remaining = await activeCount(db, group.id, cursor);
  }
  const done = remaining === 0;
  const allFailed = results.length > 0 && results.every((result) => result.status === 'failed');
  const failed = counts.failed;
  const status: CampaignStatus = done ? 'sent' : campaign.status === 'draft' ? 'sending' : campaign.status;

  // Compare-and-swap on cursor: if another batch advanced it concurrently, report
  // the newer state instead of overwriting it (which could double-send).
  const update = await db
    .prepare(
      `UPDATE campaigns SET status = ?, cursor = ?, sent_count = ?, failed_count = ?,
         sent_at = CASE WHEN ? = 1 THEN COALESCE(sent_at, ?) ELSE sent_at END,
         updated_at = ? WHERE id = ? AND cursor IS ?`,
    )
    .bind(status, cursor, counts.sent, failed, done ? 1 : 0, now, now, campaign.id, campaign.cursor)
    .run();
  if ((update.meta?.changes ?? 0) === 0) {
    const latest = await getCampaign(db, campaign.id);
    if (latest) {
      const latestCounts = await sendCounts(db, latest.id);
      const latestRemaining = await activeCount(db, group.id, latest.cursor);
      return {
        status: latest.status,
        total: latest.total,
        sent: latestCounts.sent,
        failed: latestCounts.failed,
        remaining: latestRemaining,
        done: latest.status === 'sent' && latestRemaining === 0,
      };
    }
  }

  return {
    status,
    total: campaign.total,
    sent: counts.sent,
    failed,
    remaining,
    done,
    error: allFailed ? results.find((result) => result.error)?.error ?? 'Batch delivery failed' : undefined,
  };
}

/** Loads a campaign plus its group after checking the caller's membership. */
export async function requireCampaignAccess(
  db: D1Database,
  campaignId: string,
  user: SessionUser,
  needed: GroupRole = 'admin',
): Promise<{ campaign: CampaignRow; group: GroupRow; role: GroupRole }> {
  const campaign = await getCampaign(db, campaignId);
  if (!campaign) throw new HttpError(404, 'Campaign not found.');
  const group = await queryOne<GroupRow>(db, 'SELECT * FROM groups WHERE id = ?', campaign.group_id);
  if (!group) throw new HttpError(404, 'Campaign not found.');
  const { role } = await requireMembership(db, group.id, user, needed);
  return { campaign, group, role };
}
