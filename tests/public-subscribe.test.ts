import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import type { GroupRow } from '../src/lib/types';

const BASE = 'https://lists.seanbehan.ca';
const API_URL = `${BASE}/api/public/subscribe`;

const hoisted = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));

vi.mock('../src/lib/config', () => ({
  getEnv: () => hoisted.env,
  appOrigin: (request: Request, env: Record<string, unknown>) =>
    String(env.APP_URL ?? new URL(request.url).origin).replace(/\/+$/, ''),
}));

vi.mock('../src/lib/groups', () => ({ getGroupBySlug: vi.fn() }));
vi.mock('../src/lib/subscribers', () => ({ addSubscriber: vi.fn(), findSubscriberByEmail: vi.fn() }));
vi.mock('../src/lib/turnstile', () => ({ verifyTurnstile: vi.fn() }));
vi.mock('../src/lib/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/http')>();
  return { ...actual, rateLimit: vi.fn() };
});

import { getGroupBySlug } from '../src/lib/groups';
import { rateLimit } from '../src/lib/http';
import { addSubscriber, findSubscriberByEmail } from '../src/lib/subscribers';
import { verifyTurnstile } from '../src/lib/turnstile';
import { OPTIONS, POST } from '../src/pages/api/public/subscribe';

const getGroupBySlugMock = vi.mocked(getGroupBySlug);
const rateLimitMock = vi.mocked(rateLimit);
const addSubscriberMock = vi.mocked(addSubscriber);
const findSubscriberByEmailMock = vi.mocked(findSubscriberByEmail);
const verifyTurnstileMock = vi.mocked(verifyTurnstile);

const GROUP = {
  id: 'group-1',
  slug: 'seanbehan',
  name: 'Sean Behan',
  description: '',
  from_name: '',
  from_email: '',
  reply_to: '',
  double_opt_in: 1,
  public_signup: 1,
  created_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
} as GroupRow;

type Handler = (context: APIContext) => Promise<Response>;
const callPost = (request: Request) => (POST as unknown as Handler)({ request } as APIContext);
const callOptions = (request: Request) => (OPTIONS as unknown as Handler)({ request } as APIContext);

function makeRequest(options: {
  method?: string;
  origin?: string;
  contentType?: string;
  body?: BodyInit | null;
} = {}): Request {
  const headers = new Headers();
  if (options.origin !== undefined) headers.set('origin', options.origin);
  if (options.contentType !== undefined) headers.set('content-type', options.contentType);
  return new Request(API_URL, {
    method: options.method ?? 'POST',
    headers,
    body: options.body ?? null,
  });
}

const formRequest = (values: Record<string, string>, origin?: string) =>
  makeRequest({
    origin,
    contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
    body: new URLSearchParams(values).toString(),
  });

const jsonRequest = (values: Record<string, unknown>, origin?: string) =>
  makeRequest({
    origin,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(values),
  });

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.env = {
    APP_URL: BASE,
    ENVIRONMENT: 'test',
    SINGLE_LIST: '0',
    ALLOWED_SIGNUP_ORIGINS: 'https://seanbehan.ca,https://codebam.ca',
  };
  getGroupBySlugMock.mockResolvedValue(GROUP as never);
  addSubscriberMock.mockResolvedValue({
    subscriber: {},
    existed: false,
    emailResult: { status: 'sent' },
  } as never);
  findSubscriberByEmailMock.mockResolvedValue(null);
  rateLimitMock.mockResolvedValue(true);
  verifyTurnstileMock.mockResolvedValue(true);
});

describe('public subscribe origin policy', () => {
  it('denies a cross-origin JSON post from a non-allowlisted origin', async () => {
    const response = await callPost(
      jsonRequest({ slug: 'seanbehan', email: 'user@example.com' }, 'https://evil.example'),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Cross-origin requests are not allowed.' });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(rateLimitMock).not.toHaveBeenCalled();
  });

  it('denies a cross-origin form post from a non-allowlisted origin without redirecting to next', async () => {
    const response = await callPost(
      formRequest(
        { slug: 'seanbehan', email: 'user@example.com', next: 'https://evil.example/steal' },
        'https://evil.example',
      ),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toEqual({ error: 'Cross-origin requests are not allowed.' });
  });

  it('denies opaque and malformed Origin values', async () => {
    for (const origin of ['null', 'not an origin', 'https://user:pass@seanbehan.ca']) {
      const response = await callPost(
        jsonRequest({ slug: 'seanbehan', email: 'user@example.com' }, origin),
      );
      expect(response.status).toBe(403);
    }
  });
});

describe('allowed cross-origin form flow', () => {
  it('accepts a form post and redirects to an allow-listed next with subscribed=confirm', async () => {
    const response = await callPost(
      formRequest(
        {
          slug: 'seanbehan',
          email: ' User@Example.com ',
          name: 'User',
          website: '',
          next: 'https://seanbehan.ca/test-page?utm=1',
        },
        'https://seanbehan.ca',
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://seanbehan.ca/test-page?utm=1&subscribed=confirm');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(addSubscriberMock).toHaveBeenCalledTimes(1);
    const input = addSubscriberMock.mock.calls[0]![3];
    expect(input).toMatchObject({ email: 'user@example.com', status: 'pending', source: 'public' });
  });

  it('accepts multipart/form-data', async () => {
    const form = new FormData();
    form.set('slug', 'seanbehan');
    form.set('email', 'multipart@example.com');
    form.set('website', '');
    form.set('next', 'https://codebam.ca/thanks');
    const request = new Request(API_URL, {
      method: 'POST',
      headers: { origin: 'https://codebam.ca' },
      body: form,
    });

    const response = await callPost(request);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://codebam.ca/thanks?subscribed=confirm');
    expect(addSubscriberMock).toHaveBeenCalledTimes(1);
  });

  it('redirects to /join/<slug> when next is absent', async () => {
    const response = await callPost(
      formRequest({ slug: 'seanbehan', email: 'user@example.com' }, 'https://seanbehan.ca'),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/join/seanbehan?subscribed=confirm');
  });

  it('redirects with subscribe_error=invalid for an invalid email', async () => {
    const response = await callPost(
      formRequest(
        { slug: 'seanbehan', email: 'not-an-email', next: 'https://seanbehan.ca/test-page' },
        'https://seanbehan.ca',
      ),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://seanbehan.ca/test-page?subscribe_error=invalid');
    expect(addSubscriberMock).not.toHaveBeenCalled();
  });

  it('redirects with subscribe_error=rate when the IP is throttled', async () => {
    rateLimitMock.mockResolvedValueOnce(false);
    const response = await callPost(
      formRequest(
        { slug: 'seanbehan', email: 'user@example.com', next: 'https://seanbehan.ca/test-page' },
        'https://seanbehan.ca',
      ),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://seanbehan.ca/test-page?subscribe_error=rate');
    expect(addSubscriberMock).not.toHaveBeenCalled();
  });

  it('redirects with subscribe_error=unavailable when the list is missing', async () => {
    getGroupBySlugMock.mockResolvedValueOnce(null);
    const response = await callPost(
      formRequest(
        { slug: 'nope', email: 'user@example.com', next: 'https://seanbehan.ca/test-page' },
        'https://seanbehan.ca',
      ),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://seanbehan.ca/test-page?subscribe_error=unavailable');
  });

  it('maps an existing active subscriber to subscribed=done', async () => {
    findSubscriberByEmailMock.mockResolvedValueOnce({ status: 'active' } as never);
    const response = await callPost(
      formRequest(
        { slug: 'seanbehan', email: 'user@example.com', next: 'https://seanbehan.ca/test-page' },
        'https://seanbehan.ca',
      ),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://seanbehan.ca/test-page?subscribed=done');
    expect(addSubscriberMock).not.toHaveBeenCalled();
  });

  it('lets a honeypot-filled form look successful without creating a subscriber', async () => {
    const response = await callPost(
      formRequest(
        { slug: 'seanbehan', email: 'bot@example.com', website: 'https://spam.example' },
        'https://seanbehan.ca',
      ),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/join/seanbehan?subscribed=confirm');
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(addSubscriberMock).not.toHaveBeenCalled();
  });

  it('accepts the Turnstile widget field and fails clearly without a valid token', async () => {
    hoisted.env = {
      ...hoisted.env,
      TURNSTILE_SECRET: 'secret',
      PUBLIC_TURNSTILE_SITE_KEY: 'site-key',
    };
    verifyTurnstileMock.mockResolvedValueOnce(false);
    const response = await callPost(
      formRequest(
        {
          slug: 'seanbehan',
          email: 'user@example.com',
          'cf-turnstile-response': 'widget-token',
          next: 'https://seanbehan.ca/test-page',
        },
        'https://seanbehan.ca',
      ),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://seanbehan.ca/test-page?subscribe_error=turnstile');
    expect(verifyTurnstileMock).toHaveBeenCalledWith(expect.anything(), 'widget-token', expect.any(String));
    expect(addSubscriberMock).not.toHaveBeenCalled();
  });
});

describe('malicious next values', () => {
  it.each([
    ['protocol-relative', '//evil.example/steal'],
    ['unknown absolute origin', 'https://evil.example/steal'],
    ['userinfo in authority', 'https://user:pass@seanbehan.ca/steal'],
    ['backslash trick', '/\\evil.example/steal'],
    ['control characters', '/test-page\nLocation: https://evil.example'],
    ['non-http scheme', 'javascript:alert(1)'],
  ])('ignores a %s next value', async (_name, next) => {
    const response = await callPost(
      formRequest(
        { slug: 'seanbehan', email: 'user@example.com', next },
        'https://seanbehan.ca',
      ),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/join/seanbehan?subscribed=confirm');
  });
});

describe('JSON compatibility', () => {
  it('keeps the no-Origin server-to-server JSON flow working', async () => {
    const response = await callPost(
      jsonRequest({ slug: 'seanbehan', email: 'user@example.com' }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, requiresConfirmation: true, existed: false });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(addSubscriberMock).toHaveBeenCalledTimes(1);
  });

  it('keeps same-origin JSON responses in JSON form', async () => {
    const response = await callPost(
      jsonRequest({ slug: 'seanbehan', email: 'user@example.com' }, BASE),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toMatchObject({ ok: true, requiresConfirmation: true });
  });

  it('adds CORS headers (not a redirect) to allow-listed cross-origin JSON callers', async () => {
    const response = await callPost(
      jsonRequest({ slug: 'seanbehan', email: 'user@example.com' }, 'https://seanbehan.ca'),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBe('https://seanbehan.ca');
    expect(response.headers.get('vary')).toBe('Origin');
    expect(await response.json()).toMatchObject({ ok: true, requiresConfirmation: true });
  });

  it('returns JSON errors with CORS for allow-listed JSON callers', async () => {
    const response = await callPost(
      jsonRequest({ slug: 'seanbehan', email: 'not-an-email' }, 'https://codebam.ca'),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://codebam.ca');
    expect(await response.json()).toEqual({ error: 'Enter a valid email address.' });
  });

  it('keeps accepting urlencoded bodies with no Origin as JSON responses', async () => {
    const response = await callPost(
      formRequest({ slug: 'seanbehan', email: 'proxy@example.com' }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toMatchObject({ ok: true, requiresConfirmation: true });
  });
});

describe('CORS preflight', () => {
  it('answers OPTIONS for allow-listed JSON callers without wildcards or credentials', async () => {
    const response = await callOptions(
      makeRequest({ method: 'OPTIONS', origin: 'https://codebam.ca', contentType: 'application/json' }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://codebam.ca');
    expect(response.headers.get('vary')).toBe('Origin');
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('denies OPTIONS from a non-allowlisted origin', async () => {
    const response = await callOptions(
      makeRequest({ method: 'OPTIONS', origin: 'https://evil.example', contentType: 'application/json' }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
