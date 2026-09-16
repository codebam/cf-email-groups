import { getEnv } from '../../../lib/config';
import { api } from '../../../lib/http';
import { handlePublicSubscribe, handlePublicSubscribeOptions } from '../../../lib/public-signup';

/**
 * Public sign-up endpoint.
 *
 * JSON, url-encoded and multipart bodies share one implementation in
 * `src/lib/public-signup.ts`; this file only binds it to Astro. Browser
 * origin policy (`ALLOWED_SIGNUP_ORIGINS`), no-JS form redirects and CORS
 * live there.
 */
export const POST = api(async ({ request }) => handlePublicSubscribe(request, getEnv()));

/** CORS preflight for allow-listed JSON callers, handled by the same policy. */
export const OPTIONS = api(async ({ request }) => handlePublicSubscribeOptions(request, getEnv()));
