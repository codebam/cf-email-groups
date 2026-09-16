import { devAuthEnabled, getEnv } from '../../../lib/config';
import { queryAll } from '../../../lib/db';
import { api, HttpError, json } from '../../../lib/http';
import type { EmailOutboxRow } from '../../../lib/types';

/** Dev-only mailbox: inspect the most recent rendered emails (incl. links). */
export const GET = api(async ({ url }) => {
  const env = getEnv();
  if (!devAuthEnabled(env)) throw new HttpError(404, 'Not found.');

  const to = url.searchParams.get('to');
  const kind = url.searchParams.get('kind');
  const id = url.searchParams.get('id');
  const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '10', 10) || 10));
  const where: string[] = [];
  const params: string[] = [];
  if (to) {
    where.push('to_email = ? COLLATE NOCASE');
    params.push(to);
  }
  if (kind) {
    where.push('kind = ?');
    params.push(kind);
  }
  if (id) {
    where.push('id = ?');
    params.push(id);
  }
  const rows = await queryAll<EmailOutboxRow>(
    env.DB,
    `SELECT * FROM email_outbox ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`,
    ...params,
    limit,
  );
  return json({
    emails: rows.map((row) => ({
      id: row.id,
      to: row.to_email,
      subject: row.subject,
      kind: row.kind,
      status: row.status,
      provider: row.provider,
      providerId: row.provider_id,
      error: row.error,
      createdAt: row.created_at,
      html: row.html,
      text: row.text,
    })),
  });
});
