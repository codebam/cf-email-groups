import { appOrigin, getEnv } from '../../../lib/config';
import { normalizeEmail } from '../../../lib/csv';
import { getGroupBySlug } from '../../../lib/groups';
import { singleListConfig } from '../../../lib/single';
import { api, clientIp, getString, json, rateLimit, readJson } from '../../../lib/http';
import { addSubscriber, findSubscriberByEmail } from '../../../lib/subscribers';
import { verifyTurnstile } from '../../../lib/turnstile';

export const POST = api(async ({ request }) => {
  const env = getEnv();
  const body = await readJson(request);
  const slug = getString(body, 'slug', { required: true, max: 63, label: 'List' });

  // Honeypot: bots fill the hidden field and get a fake success.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return json({ ok: true, requiresConfirmation: true });
  }

  const ip = clientIp(request);
  if (!(await rateLimit(env.DB, `subscribe:ip:${ip}`, 15, 600))) {
    return json({ error: 'Too many sign-up attempts. Please try again in a few minutes.' }, 429);
  }

  const single = singleListConfig(env);
  const group = await getGroupBySlug(env.DB, slug);
  if (single && (!group || group.slug !== single.slug)) {
    return json({ error: 'This list was not found or is not accepting sign-ups.' }, 404);
  }
  if (!group || group.public_signup !== 1) {
    return json({ error: 'This list was not found or is not accepting sign-ups.' }, 404);
  }

  // Only enforce Turnstile when both halves are configured; a secret without a
  // site key would make every sign-up impossible.
  const turnstileRequired = Boolean(env.TURNSTILE_SECRET && env.PUBLIC_TURNSTILE_SITE_KEY);
  if (turnstileRequired && !(await verifyTurnstile(env, typeof body.turnstileToken === 'string' ? body.turnstileToken : null, ip))) {
    return json({ error: 'Verification failed. Please refresh and try again.' }, 400);
  }

  const email = normalizeEmail(getString(body, 'email', { required: true, max: 254, label: 'Email' }));
  if (!email) return json({ error: 'Enter a valid email address.' }, 400);
  const name = getString(body, 'name', { max: 120, label: 'Name' });

  // Per-address throttle: silently accept so addresses can't be probed.
  if (!(await rateLimit(env.DB, `subscribe:email:${group.id}:${email}`, 3, 3600))) {
    return json({ ok: true, requiresConfirmation: group.double_opt_in === 1 });
  }

  // Never downgrade an active subscriber back to pending, and never silently
  // reactivate addresses that bounced or complained.
  const existing = await findSubscriberByEmail(env.DB, group.id, email);
  if (existing?.status === 'active') {
    return json({ ok: true, requiresConfirmation: false, existed: true });
  }
  if (existing && (existing.status === 'bounced' || existing.status === 'complained')) {
    return json({ ok: true, requiresConfirmation: true, existed: true });
  }

  const status = group.double_opt_in === 1 ? 'pending' : 'active';
  const result = await addSubscriber(
    env,
    env.DB,
    group,
    { email, name, status, source: 'public', sendWelcome: true },
    appOrigin(request, env),
  );

  return json(
    {
      ok: true,
      requiresConfirmation: status === 'pending',
      existed: result.existed,
      warning: result.emailResult?.error,
    },
    status === 'active' && result.existed ? 200 : 201,
  );
});
