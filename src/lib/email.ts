import { isProduction, type AppBindings, type SendEmailBinding } from './config';
import { execute } from './db';
import { HttpError } from './http';
import { newId } from './ids';
import type { EmailKind } from './types';

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  kind: EmailKind;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  /** RFC 8058 one-click endpoint, used in List-Unsubscribe headers. */
  listUnsubscribeUrl?: string;
}

export interface EmailResult {
  status: 'sent' | 'failed';
  providerId?: string;
  error?: string;
}

interface ProviderMessage extends OutboundEmail {
  from: string;
  replyTo?: string;
}

export interface EmailProvider {
  name: string;
  send(message: ProviderMessage): Promise<{ id?: string }>;
  sendBatch(messages: ProviderMessage[]): Promise<Array<{ id?: string; error?: string }>>;
}

/** Parses `Name <address@example.com>` or a bare address. */
/** Strips CR/LF and control characters so values can't inject email headers. */
export function cleanHeader(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim();
}

export function parseAddress(value: string | undefined | null): { name?: string; email: string } | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/.exec(trimmed);
  if (match) {
    const email = match[2]!.trim().toLowerCase();
    const name = match[1]?.trim();
    return { name: name || undefined, email };
  }
  if (/^[^\s<>]+@[^\s<>]+$/.test(trimmed)) return { email: trimmed.toLowerCase() };
  return null;
}

export function formatAddress(address: { name?: string; email: string }): string {
  return address.name ? `${cleanHeader(address.name)} <${cleanHeader(address.email)}>` : cleanHeader(address.email);
}

function logProvider(): EmailProvider {
  const send = async (message: ProviderMessage) => {
    console.log(
      `[email:log] to=${message.to} subject=${JSON.stringify(message.subject)} kind=${message.kind} unsubscribe=${message.listUnsubscribeUrl ?? '-'}`,
    );
    return { id: `log_${newId()}` };
  };
  return {
    name: 'log',
    send,
    sendBatch: async (messages) => Promise.all(messages.map(send)),
  };
}

function resendProvider(env: AppBindings): EmailProvider {
  const apiKey = env.RESEND_API_KEY!;
  const endpoint = 'https://api.resend.com/emails';
  const batchEndpoint = 'https://api.resend.com/emails/batch';

  const headersFor = (message: ProviderMessage): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (message.listUnsubscribeUrl) {
      headers['List-Unsubscribe'] = `<${message.listUnsubscribeUrl}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
    return headers;
  };

  const payloadFor = (message: ProviderMessage) => ({
    from: message.from,
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    ...(Object.keys(headersFor(message)).length ? { headers: headersFor(message) } : {}),
  });

  const post = async (url: string, body: unknown): Promise<Record<string, unknown>> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = { message: text };
    }
    if (!response.ok) {
      const detail = typeof data.message === 'string' ? data.message : `Resend returned HTTP ${response.status}`;
      throw new Error(detail);
    }
    return data;
  };

  return {
    name: 'resend',
    async send(message) {
      const data = await post(endpoint, payloadFor(message));
      return { id: typeof data.id === 'string' ? data.id : undefined };
    },
    async sendBatch(messages) {
      const results: Array<{ id?: string; error?: string }> = [];
      for (let i = 0; i < messages.length; i += 100) {
        const chunk = messages.slice(i, i + 100);
        try {
          const data = await post(
            batchEndpoint,
            chunk.map((message) => payloadFor(message)),
          );
          const ids = Array.isArray(data.data) ? data.data : [];
          chunk.forEach((_message, index) => {
            const entry = ids[index] as { id?: unknown } | undefined;
            results.push(ids.length > 0 && entry && typeof entry.id === 'string' ? { id: entry.id } : {});
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Resend batch failed';
          chunk.forEach(() => results.push({ error: message }));
        }
      }
      return results;
    },
  };
}


function headerObject(message: ProviderMessage): Record<string, string> | undefined {
  if (!message.listUnsubscribeUrl) return undefined;
  return {
    'List-Unsubscribe': `<${message.listUnsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

function addressObject(value: string): string | { email: string; name?: string } {
  const parsed = parseAddress(value);
  if (!parsed) return value;
  return parsed.name ? { email: parsed.email, name: parsed.name } : parsed.email;
}

/**
 * Cloudflare Email Service (`send_email` binding). This is the native option:
 * arbitrary recipients require the Workers Paid plan and an onboarded sending
 * domain. Cloudflare currently recommends it for transactional mail only, so
 * use Resend for large newsletter/marketing sends.
 */
function cloudflareProvider(binding: SendEmailBinding): EmailProvider {
  const send = async (message: ProviderMessage) => {
    const result = await binding.send({
      to: message.to,
      from: addressObject(message.from),
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { replyTo: addressObject(message.replyTo) } : {}),
      ...(headerObject(message) ? { headers: headerObject(message) } : {}),
    });
    return { id: result?.messageId ? `cf_${result.messageId}` : undefined };
  };
  return {
    name: 'cloudflare',
    send,
    async sendBatch(messages) {
      const results: Array<{ id?: string; error?: string }> = [];
      for (const message of messages) {
        try {
          results.push(await send(message));
        } catch (error) {
          results.push({ error: error instanceof Error ? error.message : 'Cloudflare Email Service send failed' });
        }
      }
      return results;
    },
  };
}

export function getProvider(env: AppBindings): EmailProvider {
  const explicit = (env.EMAIL_PROVIDER ?? '').trim().toLowerCase();

  if (explicit === 'resend') {
    if (!env.RESEND_API_KEY) {
      return unconfiguredProvider('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set.');
    }
    return resendProvider(env);
  }
  if (explicit === 'cloudflare' || explicit === 'cloudflare-email' || explicit === 'cf') {
    if (!env.EMAIL) return unconfiguredProvider('EMAIL_PROVIDER=cloudflare but no send_email binding named EMAIL is configured.');
    return cloudflareProvider(env.EMAIL);
  }
  if (explicit === 'log') {
    return logProvider();
  }
  if (env.RESEND_API_KEY) return resendProvider(env);
  if (env.EMAIL) return cloudflareProvider(env.EMAIL);
  if (isProduction(env)) {
    return unconfiguredProvider(
      'Email is not configured. Add a Cloudflare send_email binding, or set EMAIL_PROVIDER=resend and RESEND_API_KEY.',
    );
  }
  return logProvider();
}

function unconfiguredProvider(error: string): EmailProvider {
  return {
    name: 'unconfigured',
    async send() {
      throw new HttpError(500, error);
    },
    async sendBatch(messages) {
      return messages.map(() => ({ error }));
    },
  };
}

export function resolveFrom(env: AppBindings, message: OutboundEmail, providerName: string): string {
  if (message.fromEmail) {
    return formatAddress({ name: message.fromName, email: message.fromEmail });
  }
  const fallback = parseAddress(env.EMAIL_FROM);
  if (fallback) return formatAddress(fallback);
  if (providerName === 'log' || providerName === 'unconfigured') {
    return `${message.fromName || 'CF Email Groups'} <lists@localhost>`;
  }
  throw new HttpError(
    500,
    'No sender address configured. Set EMAIL_FROM (e.g. "My List <lists@example.com>") or set a From address in the list settings.',
  );
}

export async function sendEmail(env: AppBindings, db: D1Database, message: OutboundEmail): Promise<EmailResult> {
  const provider = getProvider(env);
  let from: string;
  try {
    from = resolveFrom(env, message, provider.name);
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : 'Invalid sender' };
  }
  const payload: ProviderMessage = {
    ...message,
    to: cleanHeader(message.to),
    subject: cleanHeader(message.subject),
    from,
    replyTo: message.replyTo,
  };
  const id = newId();
  await execute(
    db,
    `INSERT INTO email_outbox (id, to_email, subject, html, text, kind, provider, provider_id, status, error, created_at, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'queued', NULL, ?, NULL)`,
    id,
    payload.to,
    payload.subject,
    message.html,
    message.text,
    message.kind,
    provider.name,
    new Date().toISOString(),
  );
  try {
    const result = await provider.send(payload);
    await execute(
      db,
      'UPDATE email_outbox SET status = ?, provider_id = ?, sent_at = ?, error = NULL WHERE id = ?',
      'sent',
      result.id ?? null,
      new Date().toISOString(),
      id,
    );
    return { status: 'sent', providerId: result.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email delivery failed';
    await execute(db, 'UPDATE email_outbox SET status = ?, error = ? WHERE id = ?', 'failed', message, id);
    return { status: 'failed', error: message };
  }
}

export async function sendEmailBatch(env: AppBindings, db: D1Database, messages: OutboundEmail[]): Promise<EmailResult[]> {
  if (messages.length === 0) return [];
  const provider = getProvider(env);
  const results: EmailResult[] = messages.map(() => ({ status: 'failed', error: 'Not sent' }));

  // Resolve sender + journal every message first, so a provider outage leaves a full trace.
  const payloads: Array<ProviderMessage | null> = [];
  const outboxIds: string[] = [];
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    const id = newId();
    outboxIds.push(id);
    try {
      const from = resolveFrom(env, message, provider.name);
      const payload: ProviderMessage = {
        ...message,
        to: cleanHeader(message.to),
        subject: cleanHeader(message.subject),
        from,
        replyTo: message.replyTo,
      };
      payloads.push(payload);
      statements.push(
        db
          .prepare(
            `INSERT INTO email_outbox (id, to_email, subject, html, text, kind, provider, provider_id, status, error, created_at, sent_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'queued', NULL, ?, NULL)`,
          )
          .bind(
            id,
            payload.to,
            payload.subject,
            message.kind === 'campaign' ? '' : message.html,
            message.kind === 'campaign' ? '' : message.text,
            message.kind,
            provider.name,
            new Date().toISOString(),
          ),
      );
    } catch (error) {
      payloads.push(null);
      results[index] = { status: 'failed', error: error instanceof Error ? error.message : 'Invalid sender' };
    }
  }

  if (statements.length > 0) await db.batch(statements);

  const toSend = payloads.map((payload, index) => ({ payload, index })).filter((item) => item.payload !== null);
  let providerResults: Array<{ id?: string; error?: string }> = [];
  if (toSend.length > 0) {
    try {
      providerResults = await provider.sendBatch(toSend.map((item) => item.payload!));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Email batch failed';
      providerResults = toSend.map(() => ({ error: message }));
    }
  }

  const updates: D1PreparedStatement[] = [];
  toSend.forEach((item, offset) => {
    const providerResult = providerResults[offset] ?? { error: 'No delivery result' };
    const index = item.index;
    if (providerResult.error) {
      results[index] = { status: 'failed', error: providerResult.error };
      updates.push(
        db
          .prepare('UPDATE email_outbox SET status = ?, error = ? WHERE id = ?')
          .bind('failed', providerResult.error, outboxIds[index]),
      );
    } else {
      results[index] = { status: 'sent', providerId: providerResult.id };
      updates.push(
        db
          .prepare('UPDATE email_outbox SET status = ?, provider_id = ?, sent_at = ? WHERE id = ?')
          .bind('sent', providerResult.id ?? null, new Date().toISOString(), outboxIds[index]),
      );
    }
  });
  if (updates.length > 0) await db.batch(updates);

  // Messages that failed before reaching the provider still get a journal update.
  const preFailures: D1PreparedStatement[] = [];
  payloads.forEach((payload, index) => {
    if (payload === null) {
      preFailures.push(
        db
          .prepare('UPDATE email_outbox SET status = ?, error = ? WHERE id = ?')
          .bind('failed', results[index]!.error ?? 'Invalid sender', outboxIds[index]),
      );
    }
  });
  if (preFailures.length > 0) await db.batch(preFailures);

  return results;
}

