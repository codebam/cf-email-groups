import { appOrigin, type AppBindings } from './config';
import { normalizeEmail } from './csv';
import { getGroupBySlug } from './groups';
import {
  clientIp,
  getString,
  HttpError,
  isFormContentType,
  json,
  rateLimit,
  readBody,
  seeOther,
} from './http';
import {
  isAllowedSignupOrigin,
  normalizeOrigin,
  parseAllowedSignupOrigins,
  resolveSafeNext,
  subscribeFallbackPath,
  withSignupResult,
  type SignupErrorCode,
  type SignupOriginPolicy,
  type SignupResult,
} from './signup-origins';
import { singleListConfig } from './single';
import { addSubscriber, findSubscriberByEmail } from './subscribers';
import { verifyTurnstile } from './turnstile';

interface SignupRequestState {
  requestOrigin: string;
  allowedOrigins: Set<string>;
  allowedCrossOrigin: boolean;
  formPost: boolean;
  corsHeaders: Record<string, string>;
}

function requestState(request: Request, env: AppBindings): SignupRequestState | Response {
  const requestOrigin = new URL(request.url).origin;
  const allowedOrigins = parseAllowedSignupOrigins(env);
  const originHeader = request.headers.get('origin');
  const origin = normalizeOrigin(originHeader);

  // A malformed or opaque (`null`) Origin must never fall through as if it
  // were absent. Only a completely missing Origin is server-to-server.
  if (originHeader !== null && origin === null) {
    return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  }

  const sameOrigin = origin !== null && origin === requestOrigin;
  const allowedOrigin = origin !== null && !sameOrigin && isAllowedSignupOrigin(origin, allowedOrigins) ? origin : null;
  if (originHeader !== null && !sameOrigin && allowedOrigin === null) {
    return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  }

  return {
    requestOrigin,
    allowedOrigins,
    allowedCrossOrigin: allowedOrigin !== null,
    formPost: isFormContentType(request.headers.get('content-type')) && (sameOrigin || allowedOrigin !== null),
    corsHeaders: allowedOrigin !== null ? { 'access-control-allow-origin': allowedOrigin, vary: 'Origin' } : {},
  };
}

export async function handlePublicSubscribe(request: Request, env: AppBindings): Promise<Response> {
  const state = requestState(request, env);
  if (state instanceof Response) return state;
  const { requestOrigin, allowedOrigins, formPost, corsHeaders } = state;
  const policy: SignupOriginPolicy = { requestOrigin, allowedOrigins };

  // ---- Body parsing -------------------------------------------------------
  let body: Record<string, unknown>;
  try {
    body = await readBody(request);
  } catch (error) {
    // A form post from a browser should still end in a 303, even when the body
    // is unreadable. The request has already failed, so there is no safe slug
    // to recover; fall back to the public sign-up page root.
    if (formPost) {
      return seeOther(
        withSignupResult('/', requestOrigin, { subscribe_error: 'invalid' }),
      );
    }
    if (error instanceof HttpError) return json({ error: error.message }, error.status, corsHeaders);
    console.error('[cf-email-groups] public subscribe body read failed', error);
    return json({ error: 'Something went wrong. Please try again.' }, 500, corsHeaders);
  }

  // Best-effort fallback available for every validation error below.
  let slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const targetFor = (result: SignupResult) =>
    withSignupResult(
      resolveSafeNext(body.next, policy) ?? subscribeFallbackPath(slug),
      requestOrigin,
      result,
    );
  const fail = (status: number, message: string, code: SignupErrorCode): Response => {
    if (formPost) return seeOther(targetFor({ subscribe_error: code }));
    return json({ error: message }, status, corsHeaders);
  };
  const unexpected = (error: unknown): Response => {
    if (formPost) {
      console.error('[cf-email-groups] public subscribe failed', error);
      return seeOther(targetFor({ subscribe_error: 'unavailable' }));
    }
    console.error('[cf-email-groups] unhandled error', error);
    return json({ error: 'Something went wrong. Please try again.' }, 500, corsHeaders);
  };

  // Reuse the same field validation as the JSON API.
  try {
    slug = getString(body, 'slug', { required: true, max: 63, label: 'List' });
  } catch (error) {
    if (error instanceof HttpError) return fail(error.status, error.message, 'invalid');
    return unexpected(error);
  }

  // Honeypot: bots fill the hidden field and get a fake success. Before the
  // group is known the redirect flow can only imitate the common double opt-in
  // result; the important part is that no subscriber is created.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    if (formPost) return seeOther(targetFor({ subscribed: 'confirm' }));
    return json({ ok: true, requiresConfirmation: true }, 200, corsHeaders);
  }

  try {
    const ip = clientIp(request);
    if (!(await rateLimit(env.DB, `subscribe:ip:${ip}`, 15, 600))) {
      return fail(429, 'Too many sign-up attempts. Please try again in a few minutes.', 'rate');
    }

    const single = singleListConfig(env);
    const group = await getGroupBySlug(env.DB, slug);
    if (!group) return fail(404, 'This list was not found or is not accepting sign-ups.', 'unavailable');
    if (single && group.slug !== single.slug) {
      return fail(404, 'This list was not found or is not accepting sign-ups.', 'unavailable');
    }
    if (group.public_signup !== 1) {
      return fail(404, 'This list was not found or is not accepting sign-ups.', 'unavailable');
    }

    // Only enforce Turnstile when both halves are configured; a secret without
    // a site key would make every sign-up impossible. No-JS form posts can
    // carry the widget's implicit `cf-turnstile-response` field; JSON/JS
    // clients use `turnstileToken`.
    const turnstileRequired = Boolean(env.TURNSTILE_SECRET && env.PUBLIC_TURNSTILE_SITE_KEY);
    if (turnstileRequired) {
      const responseToken = body['cf-turnstile-response'];
      const token =
        typeof body.turnstileToken === 'string' && body.turnstileToken.trim()
          ? body.turnstileToken.trim()
          : typeof responseToken === 'string' && responseToken.trim()
            ? responseToken.trim()
            : null;
      if (!(await verifyTurnstile(env, token, ip))) {
        return fail(400, 'Verification failed. Please refresh and try again.', 'turnstile');
      }
    }

    let email: string | null = null;
    let name = '';
    try {
      email = normalizeEmail(getString(body, 'email', { required: true, max: 254, label: 'Email' }));
      name = getString(body, 'name', { max: 120, label: 'Name' });
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.message, 'invalid');
      return unexpected(error);
    }
    if (!email) return fail(400, 'Enter a valid email address.', 'invalid');

    // Per-address throttle: silently accept so addresses can't be probed.
    if (!(await rateLimit(env.DB, `subscribe:email:${group.id}:${email}`, 3, 3600))) {
      const requiresConfirmation = group.double_opt_in === 1;
      if (formPost) return seeOther(targetFor({ subscribed: requiresConfirmation ? 'confirm' : 'done' }));
      return json({ ok: true, requiresConfirmation }, 200, corsHeaders);
    }

    // Never downgrade an active subscriber back to pending, and never silently
    // reactivate addresses that bounced or complained.
    const existing = await findSubscriberByEmail(env.DB, group.id, email);
    if (existing?.status === 'active') {
      if (formPost) return seeOther(targetFor({ subscribed: 'done' }));
      return json({ ok: true, requiresConfirmation: false, existed: true }, 200, corsHeaders);
    }
    if (existing && (existing.status === 'bounced' || existing.status === 'complained')) {
      if (formPost) return seeOther(targetFor({ subscribed: 'confirm' }));
      return json({ ok: true, requiresConfirmation: true, existed: true }, 200, corsHeaders);
    }

    const status = group.double_opt_in === 1 ? 'pending' : 'active';
    const result = await addSubscriber(
      env,
      env.DB,
      group,
      { email, name, status, source: 'public', sendWelcome: true },
      appOrigin(request, env),
    );

    if (formPost) {
      return seeOther(targetFor({ subscribed: status === 'pending' ? 'confirm' : 'done' }));
    }
    return json(
      {
        ok: true,
        requiresConfirmation: status === 'pending',
        existed: result.existed,
        warning: result.emailResult?.error,
      },
      status === 'active' && result.existed ? 200 : 201,
      corsHeaders,
    );
  } catch (error) {
    return unexpected(error);
  }
}

/**
 * CORS preflight for allow-listed JSON callers. The no-JS form flow doesn't
 * use this: browsers submit cross-origin forms without a preflight.
 */
export async function handlePublicSubscribeOptions(request: Request, env: AppBindings): Promise<Response> {
  const state = requestState(request, env);
  if (state instanceof Response) return state;

  const headers: Record<string, string> = {
    allow: 'POST, OPTIONS',
    'cache-control': 'no-store',
  };
  if (state.allowedCrossOrigin) {
    const origin = normalizeOrigin(request.headers.get('origin'));
    headers['access-control-allow-origin'] = origin!;
    headers['access-control-allow-methods'] = 'POST, OPTIONS';
    headers['access-control-allow-headers'] = 'Content-Type';
    headers['access-control-max-age'] = '600';
    headers.vary = 'Origin';
  }
  return new Response(null, { status: 204, headers });
}
