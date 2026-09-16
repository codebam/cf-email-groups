// ID / token / slug helpers built on Web Crypto (available in workerd and Node 18+).

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function newId(): string {
  return crypto.randomUUID();
}

/** URL-safe random token. 32 bytes -> 43 chars. */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64Url(buf);
}

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA256 as base64 (used for webhook signature verification). */
export async function hmacSha256Base64(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(a, b);
}
export { safeEqual };

/** Only allow same-site relative redirects (prevents open redirects). */
export function safeRedirect(value: string | null | undefined, fallback = '/app'): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (value.includes('://')) return fallback;
  return value.slice(0, 512);
}

/** Returns a unique slug using `slugify`, appending -2, -3... when taken. */
export function nextSlugCandidate(base: string, attempt: number): string {
  const slug = slugify(base) || 'list';
  if (attempt <= 1) return slug;
  const suffix = `-${attempt}`;
  return `${slug.slice(0, 63 - suffix.length)}${suffix}`;
}
