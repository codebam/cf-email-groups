import type { APIContext, APIRoute } from 'astro';
import type { SessionUser } from './types';

export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message, details: error.details }, error.status);
  }
  console.error('[cf-email-groups] unhandled error', error);
  return json({ error: 'Something went wrong. Please try again.' }, 500);
}

/** Wraps an API route with JSON error handling. */
export function api(handler: (context: APIContext) => Response | Promise<Response>): APIRoute {
  return (async (context: APIContext) => {
    try {
      return await handler(context);
    } catch (error) {
      return errorResponse(error);
    }
  }) as APIRoute;
}

export function requireUser(locals: App.Locals): SessionUser {
  if (!locals.user) throw new HttpError(401, 'Please sign in first.');
  return locals.user;
}

export async function readJson(request: Request, maxBytes = 1_000_000): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new HttpError(413, 'Request body is too large.');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request body is too large.');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'Expected a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

export interface StringOptions {
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  label?: string;
}

export function getString(body: Record<string, unknown>, key: string, options: StringOptions = {}): string {
  const label = options.label ?? key;
  const raw = body[key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value && options.required) throw new HttpError(400, `${label} is required.`);
  if (!value) return '';
  if (options.min !== undefined && value.length < options.min) {
    throw new HttpError(400, `${label} must be at least ${options.min} characters.`);
  }
  if (options.max !== undefined && value.length > options.max) {
    throw new HttpError(400, `${label} must be at most ${options.max} characters.`);
  }
  if (options.pattern && !options.pattern.test(value)) throw new HttpError(400, `${label} is not valid.`);
  return value;
}

export function getInt(
  body: Record<string, unknown>,
  key: string,
  fallback: number,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const raw = body[key];
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function getBool(body: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = body[key];
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === '1' || raw === 1) return true;
  if (raw === 'false' || raw === '0' || raw === 0) return false;
  return fallback;
}

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAge?: number; secure?: boolean; path?: string; httpOnly?: boolean; sameSite?: 'Lax' | 'Strict' | 'None' } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly ?? true) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/** Append (rather than overwrite) Set-Cookie headers on a Response. */
export function appendCookie(response: Response, cookie: string): Response {
  response.headers.append('set-cookie', cookie);
  return response;
}

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}

export function requireSameOrigin(request: Request, url: URL): void {
  const origin = request.headers.get('origin');
  if (!origin) return; // same-origin fetches always send Origin; non-browser clients may not
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Invalid origin.');
  }
  if (host !== url.host) throw new HttpError(403, 'Cross-origin requests are not allowed.');
}

export function pagination(url: URL, defaults: { page?: number; pageSize?: number; maxPageSize?: number } = {}) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || defaults.page || 1);
  const pageSize = Math.min(
    defaults.maxPageSize ?? 100,
    Math.max(1, Number.parseInt(url.searchParams.get('pageSize') ?? '', 10) || defaults.pageSize || 50),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Fixed-window rate limit backed by D1. Returns true when the call is allowed. */
export async function rateLimit(db: D1Database, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - windowSeconds;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END
       RETURNING count`,
    )
    .bind(key, now, cutoff, cutoff, now)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
