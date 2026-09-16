// Browser-origin policy for the public sign-up endpoint.
//
// The allow-list is deployment config (`ALLOWED_SIGNUP_ORIGINS`), never
// hardcoded in the route. It has two jobs:
//   1. decide whether a cross-origin browser request may use the endpoint;
//   2. vet the `next` return URL used by the no-JavaScript form flow.
//
// Everything here is pure so it can be unit-tested outside Workerd.

import type { AppBindings } from './config';

export interface SignupOriginPolicy {
  /** Origin of the Worker doing the redirecting (`new URL(request.url).origin`). */
  requestOrigin: string;
  /** Normalized origins from `ALLOWED_SIGNUP_ORIGINS`. */
  allowedOrigins: ReadonlySet<string>;
}

export type SignupErrorCode = 'invalid' | 'rate' | 'unavailable' | 'turnstile';

export interface SignupResult {
  subscribed?: 'confirm' | 'done';
  subscribe_error?: SignupErrorCode;
}

/** The control characters that must never reach a `Location` header. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MAX_NEXT_LENGTH = 2_048;
const SLUG_FALLBACK_CHARACTERS = /[^A-Za-z0-9-]/g;

/**
 * Parses `ALLOWED_SIGNUP_ORIGINS` (comma-separated `scheme://host[:port]`).
 * Invalid entries, non-http(s) schemes and `*` are ignored. Matching is exact
 * after URL normalization (default ports dropped, host lowercased), so
 * `https://seanbehan.ca:443` and `https://seanbehan.ca` are the same origin.
 */
export function parseAllowedSignupOrigins(
  env: Pick<AppBindings, 'ALLOWED_SIGNUP_ORIGINS'>,
): Set<string> {
  const origins = new Set<string>();
  for (const entry of (env.ALLOWED_SIGNUP_ORIGINS ?? '').split(',')) {
    const value = entry.trim();
    if (!value || value === '*') continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (url.username || url.password) continue;
    // Reject origins with a path/query/fragment instead of silently widening
    // a malformed entry to the whole host.
    if (url.pathname !== '/' || url.search || url.hash) continue;
    origins.add(url.origin);
  }
  return origins;
}

/**
 * Normalizes a browser `Origin` header to `scheme://host[:port]`.
 * Returns null for absent, malformed, credential-bearing or non-http(s)
 * values (including the literal `Origin: null` from sandboxed documents).
 */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  // An Origin header is a serialized origin, never a URL with a path.
  if (url.pathname !== '/' || url.search || url.hash) return null;
  return url.origin;
}

/** True when `origin` is one of the configured allowed origins. */
export function isAllowedSignupOrigin(origin: string | null, allowedOrigins: ReadonlySet<string>): boolean {
  return origin !== null && allowedOrigins.has(origin);
}

/**
 * Resolves `next` to a safe redirect target, or null when it must be ignored.
 *
 * Accepted:
 *   - absolute same-origin paths (`/news?page=2#top`);
 *   - absolute http(s) URLs on this Worker's own origin or on an allow-listed
 *     origin, with no userinfo.
 *
 * Rejected: protocol-relative URLs (`//host`), backslashes, control
 * characters, non-http(s) schemes, and every other origin.
 */
export function resolveSafeNext(value: unknown, policy: SignupOriginPolicy): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_NEXT_LENGTH) return null;
  if (CONTROL_CHARACTERS.test(raw)) return null;
  if (raw.includes('\\')) return null;
  if (raw.startsWith('//')) return null;

  if (raw.startsWith('/')) {
    try {
      const url = new URL(raw, policy.requestOrigin);
      if (url.origin !== policy.requestOrigin) return null;
      return url.pathname + url.search + url.hash;
    } catch {
      return null;
    }
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.origin !== policy.requestOrigin && !policy.allowedOrigins.has(url.origin)) return null;
  return url.origin + url.pathname + url.search + url.hash;
}

/**
 * Fallback return path when `next` is missing or rejected. Only slug-safe
 * characters are copied in, so the result can never escape `/join/`.
 */
export function subscribeFallbackPath(slug: string | null | undefined): string {
  const clean = typeof slug === 'string' ? slug.replace(SLUG_FALLBACK_CHARACTERS, '').slice(0, 63) : '';
  return clean ? `/join/${clean}` : '/';
}

/**
 * Appends the subscribe result to a safe target. Stale `subscribed` /
 * `subscribe_error` params are replaced so a replayed link can't show an old
 * result. Same-origin path targets stay relative; absolute targets stay
 * absolute.
 */
export function withSignupResult(target: string, requestOrigin: string, result: SignupResult): string {
  const url = new URL(target, requestOrigin);
  url.searchParams.delete('subscribed');
  url.searchParams.delete('subscribe_error');
  if (result.subscribed) url.searchParams.set('subscribed', result.subscribed);
  if (result.subscribe_error) url.searchParams.set('subscribe_error', result.subscribe_error);
  return target.startsWith('/') && !target.startsWith('//')
    ? url.pathname + url.search + url.hash
    : url.origin + url.pathname + url.search + url.hash;
}
