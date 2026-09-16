import { defineMiddleware } from 'astro:middleware';
import { getEnv, isProduction } from './lib/config';
import { assertSchemaApplied, isMissingSchemaError } from './lib/db';
import { ensureSingleList, ensureSingleListMembership } from './lib/groups';
import { json } from './lib/http';
import { getUserFromRequest } from './lib/sessions';
import { isLoginAllowed, singleListConfig } from './lib/single';

let lastSchemaCheck = 0;

/** Cheap probe, memoised per isolate so we don't hit D1 on every request. */
async function schemaIsUsable(db: D1Database): Promise<boolean> {
  if (Date.now() - lastSchemaCheck < 60_000) return true;
  try {
    await assertSchemaApplied(db);
    lastSchemaCheck = Date.now();
    return true;
  } catch (error) {
    if (isMissingSchemaError(error)) {
      console.error('[cf-email-groups] D1 schema missing — run: pnpm db:migrate:remote');
      return false;
    }
    console.error('[cf-email-groups] D1 schema probe failed', error);
    return true; // Let the request surface the real error.
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

export const onRequest = defineMiddleware(async (context, next) => {
  const env = getEnv();
  // /api/health reports DB state itself; everything else gets the friendly 503.
  if (context.url.pathname !== '/api/health' && !(await schemaIsUsable(env.DB))) {
    return new Response(
      'CF-Email-Groups: the D1 database has not been initialised.\n\n' +
        'Apply the schema and reload:\n' +
        '  pnpm db:migrate:remote\n' +
        '  # or: pnpm exec wrangler d1 migrations apply DB --remote\n',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } },
    );
  }

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
  // /api/public/subscribe owns its configurable origin policy (ALLOWED_SIGNUP_ORIGINS)
  // because it is intentionally reachable from allow-listed host pages.
  const publicSubscribe = context.url.pathname === '/api/public/subscribe';
  if (
    context.url.pathname.startsWith('/api/') &&
    !publicSubscribe &&
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
