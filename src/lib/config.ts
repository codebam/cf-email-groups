import { env } from 'cloudflare:workers';

/**
 * Shape of the Worker bindings and secrets. `DB` and `ENVIRONMENT` are also in
 * the generated worker-configuration.d.ts; everything else is a secret or an
 * optional non-secret var documented in README.md.
 */
/** Minimal structural type for Cloudflare Email Service's `send_email` binding. */
export interface SendEmailBinding {
  send(message: {
    to: string;
    from: string | { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string | { email: string; name?: string };
    headers?: Record<string, string>;
  }): Promise<{ messageId?: string }>;
}

export interface AppBindings {
  DB: D1Database;
  /** Present when `send_email` is configured in wrangler.jsonc. */
  EMAIL?: SendEmailBinding;
  ENVIRONMENT?: string;
  APP_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  EMAIL_PROVIDER?: string; // 'cloudflare' | 'resend' | 'log'
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  TURNSTILE_SECRET?: string;
  PUBLIC_TURNSTILE_SITE_KEY?: string;
  /** Optional comma-separated GitHub logins allowed to sign in. */
  ALLOWED_GITHUB_LOGINS?: string;
  /** Set to "1" for a deployment dedicated to one mailing list. */
  SINGLE_LIST?: string;
  SINGLE_LIST_SLUG?: string;
  SINGLE_LIST_NAME?: string;
  SINGLE_LIST_DESCRIPTION?: string;
  /** Set to "1" to force visitors onto APP_URL's host. */
  ENFORCE_CANONICAL_HOST?: string;
  DEV_AUTH?: string;
}

export function getEnv(): AppBindings {
  return env as unknown as AppBindings;
}

export function isProduction(env: AppBindings): boolean {
  return env.ENVIRONMENT === 'production';
}

export function appOrigin(request: Request, env: AppBindings): string {
  return (env.APP_URL || new URL(request.url).origin).replace(/\/+$/, '');
}

export function devAuthEnabled(env: AppBindings): boolean {
  return env.DEV_AUTH === '1' && !isProduction(env);
}
