import { getEnv } from '../../../lib/config';
import { api, json } from '../../../lib/http';
import { clearSessionCookie, destroySession } from '../../../lib/sessions';

export const POST = api(async ({ request, url }) => {
  const env = getEnv();
  await destroySession(request, env.DB);
  const response = json({ ok: true });
  response.headers.append('set-cookie', clearSessionCookie(url.protocol === 'https:'));
  return response;
});
