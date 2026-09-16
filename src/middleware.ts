import { defineMiddleware } from 'astro:middleware';
import { getEnv, isProduction } from './lib/config';
import { ensureSingleList, ensureSingleListMembership } from './lib/groups';
import { json } from './lib/http';
import { getUserFromRequest } from './lib/sessions';
import { isLoginAllowed, singleListConfig } from './lib/single';

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

export const onRequest = defineMiddleware(async (context, next) => {
  const env = getEnv();
  let user = await getUserFromRequest(context.request, env.DB).catch((error) => {
    console.error('[cf-email-groups] session lookup failed', error);
    return null;
  });
  // Revoke sessions that are no longer on the sign-in allow-list. Local dev is
  // exempt so the DEV_AUTH shortcut can sign in as any throwaway username.
  if (user && isProduction(env) && !isLoginAllowed(env, user.login)) user = null;
  context.locals.user = user;

  // Force production traffic onto the canonical domain (e.g. lists.seanbehan.ca).
  if (
    env.ENFORCE_CANONICAL_HOST === '1' &&
    isProduction(env) &&
    env.APP_URL &&
    context.request.method === 'GET' &&
    !context.url.pathname.startsWith('/api/')
  ) {
    try {
      const canonical = new URL(env.APP_URL);
      if (context.url.host !== canonical.host) {
        return context.redirect(`${canonical.origin}${context.url.pathname}${context.url.search}`, 302);
      }
    } catch (error) {
      console.error('[cf-email-groups] invalid APP_URL', error);
    }
  }

  // Single-list deployments bootstrap their one list lazily and attach signed-in users.
  if (singleListConfig(env)) {
    try {
      await ensureSingleList(env.DB, env);
      if (context.locals.user) await ensureSingleListMembership(env.DB, env, context.locals.user);
    } catch (error) {
      console.error('[cf-email-groups] single-list bootstrap failed', error);
    }
  }

  // Same-origin guard for cookie-authenticated mutations (SameSite=Lax plus Origin check).
  if (
    context.url.pathname.startsWith('/api/') &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(context.request.method)
  ) {
    const origin = context.request.headers.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== context.url.host) {
          return json({ error: 'Cross-origin requests are not allowed.' }, 403);
        }
      } catch {
        return json({ error: 'Cross-origin requests are not allowed.' }, 403);
      }
    }
  }

  const response = await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) response.headers.set(name, value);
  }
  if (context.url.pathname.startsWith('/api/')) {
    response.headers.set('cache-control', 'no-store');
  }
  return response;
});
