import { devAuthEnabled, getEnv, isProduction } from '../../../lib/config';
import { execute, queryOne } from '../../../lib/db';
import { api, HttpError } from '../../../lib/http';
import { newId } from '../../../lib/ids';
import { createSessionForUser } from '../../../lib/sessions';
import type { UserRow } from '../../../lib/types';
import { linkPendingInvites } from '../../../lib/users';

function syntheticGithubId(login: string): number {
  let hash = 2166136261;
  for (const char of login.toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return -1 - Math.abs(hash >>> 0);
}

/**
 * Local-development sign-in shortcut. Enabled only when DEV_AUTH=1 and the
 * environment is not production, so it can never be a production backdoor.
 */
export const GET = api(async ({ request, url }) => {
  const env = getEnv();
  if (!devAuthEnabled(env)) throw new HttpError(404, 'Not found.');
  if (isProduction(env)) throw new HttpError(404, 'Not found.');

  const login = (url.searchParams.get('login') || 'devuser').trim().replace(/^@/, '');
  if (!/^[a-zA-Z0-9-]{1,39}$/.test(login)) throw new HttpError(400, 'Invalid login name.');

  const githubId = syntheticGithubId(login);
  const now = new Date().toISOString();
  let user = await queryOne<UserRow>(env.DB, 'SELECT * FROM users WHERE github_login = ? COLLATE NOCASE', login);
  if (!user) {
    const existingSynthetic = await queryOne<UserRow>(env.DB, 'SELECT * FROM users WHERE github_id = ?', githubId);
    if (existingSynthetic) {
      user = existingSynthetic;
    } else {
      const id = newId();
      await execute(
        env.DB,
        `INSERT INTO users (id, github_id, github_login, name, email, avatar_url, created_at, last_login_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
        id,
        githubId,
        login,
        `${login} (dev)`,
        now,
        now,
      );
      user = await queryOne<UserRow>(env.DB, 'SELECT * FROM users WHERE id = ?', id);
    }
  } else {
    await execute(env.DB, 'UPDATE users SET last_login_at = ? WHERE id = ?', now, user.id);
  }
  if (!user) throw new Error('Failed to create dev user');
  await linkPendingInvites(env.DB, user);

  const cookie = await createSessionForUser(env.DB, user.id, request.headers.get('user-agent'), url.protocol === 'https:');
  const redirect = url.searchParams.get('redirect') || '/app';
  const target = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/app';
  const response = new Response(null, { status: 302, headers: { location: target } });
  response.headers.append('set-cookie', cookie);
  return response;
});
