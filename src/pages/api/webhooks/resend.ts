import { getEnv } from '../../../lib/config';
import { execute } from '../../../lib/db';
import { api, json } from '../../../lib/http';
import { timingSafeEqual } from '../../../lib/ids';

async function verifySvix(request: Request, rawBody: string, secret: string): Promise<boolean> {
  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signature = request.headers.get('svix-signature');
  if (!id || !timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const secretBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));

  return signature
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .some((part) => timingSafeEqual(part.slice(3), expected));
}

function firstRecipient(value: unknown): string | null {
  if (typeof value === 'string') return value.toLowerCase();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].toLowerCase();
  return null;
}

export const POST = api(async ({ request }) => {
  const env = getEnv();
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'Webhook signing secret is not configured.' }, 404);

  const rawBody = await request.text();
  if (!(await verifySvix(request, rawBody, secret))) {
    return json({ error: 'Invalid webhook signature.' }, 401);
  }

  let event: { type?: string; data?: { to?: unknown } };
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const type = event.type ?? 'unknown';
  if (type === 'email.bounced' || type === 'email.complained') {
    const email = firstRecipient(event.data?.to);
    if (email) {
      const status = type === 'email.bounced' ? 'bounced' : 'complained';
      await execute(
        env.DB,
        `UPDATE subscribers SET status = ?, updated_at = ?
         WHERE email = ? COLLATE NOCASE AND status IN ('active', 'pending')`,
        status,
        new Date().toISOString(),
        email,
      );
    }
  }

  return json({ ok: true, type });
});
