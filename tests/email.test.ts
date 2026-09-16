import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ env: {} }));

import { getProvider } from '../src/lib/email';

const campaignMessage = {
  to: 'codebam@riseup.net',
  from: 'Sean Behan <lists@seanbehan.ca>',
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: 'Hi',
  kind: 'campaign',
  listUnsubscribeUrl: 'https://lists.seanbehan.ca/api/public/unsubscribe?token=abc',
} as never;

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('email providers', () => {
  it('retries Cloudflare sends without custom headers when the header allowlist rejects them', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const binding = {
      async send(message: Record<string, unknown>) {
        calls.push(message);
        if (message.headers) {
          const error = new Error("Header 'List-Unsubscribe' is not allowed.") as Error & { code?: string };
          error.code = 'E_HEADER_NOT_ALLOWED';
          throw error;
        }
        return { messageId: 'm1' };
      },
    };
    const provider = getProvider({ EMAIL: binding, ENVIRONMENT: 'production' } as never);
    const result = await provider.send(campaignMessage);
    expect(result.id).toBe('cf_m1');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers).toBeDefined();
    expect(calls[1]!.headers).toBeUndefined();
  });

  it('does not retry Cloudflare recipient errors without headers', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const binding = {
      async send(message: Record<string, unknown>) {
        calls.push(message);
        const error = new Error('Recipient not allowed') as Error & { code?: string };
        error.code = 'E_RECIPIENT_NOT_ALLOWED';
        throw error;
      },
    };
    const provider = getProvider({ EMAIL: binding, ENVIRONMENT: 'production' } as never);
    await expect(provider.send(campaignMessage)).rejects.toThrow('Recipient not allowed');
    expect(calls).toHaveLength(1);
  });

  it('falls back to individual Resend sends when the batch endpoint fails', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/emails/batch')) {
        return new Response(JSON.stringify({ message: 'batch unavailable' }), { status: 500 });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { to?: string[] };
      return new Response(JSON.stringify({ id: `single-${body.to?.[0] ?? 'x'}` }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = getProvider({ RESEND_API_KEY: 'test-key' } as never);
    const messages = [
      { ...(campaignMessage as Record<string, unknown>), to: 'a@example.com' },
      { ...(campaignMessage as Record<string, unknown>), to: 'b@example.com' },
    ] as never[];
    const results = await provider.sendBatch(messages);
    expect(results).toEqual([{ id: 'single-a@example.com' }, { id: 'single-b@example.com' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3); // one batch attempt + two individual sends
  });
});
