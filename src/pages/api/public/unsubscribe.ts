import { getEnv } from '../../../lib/config';
import { api, json } from '../../../lib/http';
import { unsubscribeByToken } from '../../../lib/subscribers';

/** RFC 8058 one-click unsubscribe endpoint (also usable from the footer page). */
export const POST = api(async ({ url }) => {
  const env = getEnv();
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'Missing unsubscribe token.' }, 400);
  const result = await unsubscribeByToken(env.DB, token);
  if (!result.ok) return json({ error: 'This unsubscribe link is not valid.' }, 404);
  return json({ ok: true, already: result.already ?? false, group: result.groupName ?? null });
});
