import { appOrigin, getEnv } from '../../../../lib/config';
import { exchangeCodeForToken, fetchGitHubProfile } from '../../../../lib/github';
import { api, HttpError, serializeCookie } from '../../../../lib/http';
import { safeRedirect } from '../../../../lib/ids';
import { createSessionForUser } from '../../../../lib/sessions';
import { linkPendingInvites, upsertGitHubUser } from '../../../../lib/users';

function loginRedirect(location: string, clearOauthCookie: string): Response {
  const response = new Response(null, { status: 302, headers: { location } });
  response.headers.append('set-cookie', clearOauthCookie);
  return response;
}

export const GET = api(async ({ request, url, cookies }) => {
  const env = getEnv();
  const secure = url.protocol === 'https:';
  const clearOauthCookie = serializeCookie('eg_oauth', '', {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    maxAge: 0,
  });
  const fail = (reason: string) =>
    loginRedirect(`/login?error=${encodeURIComponent(reason)}`, clearOauthCookie);

  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return fail('github_not_configured');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const rawCookie = cookies.get('eg_oauth')?.value;
  if (!code || !state || !rawCookie) return fail('oauth_state');

  let oauthState: { state?: string; redirect?: string };
  try {
    oauthState = JSON.parse(rawCookie) as { state?: string; redirect?: string };
  } catch {
    return fail('oauth_state');
  }
  if (!oauthState.state || oauthState.state !== state) return fail('oauth_state');

  try {
    const callbackUrl = `${appOrigin(request, env)}/api/auth/github/callback`;
    const accessToken = await exchangeCodeForToken({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      code,
      callbackUrl,
    });
    const profile = await fetchGitHubProfile(accessToken);
    const allowed = (env.ALLOWED_GITHUB_LOGINS ?? '')
      .split(',')
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(profile.login.toLowerCase())) {
      return fail('not_allowed');
    }
    const user = await upsertGitHubUser(env.DB, profile);
    await linkPendingInvites(env.DB, user);
    const cookie = await createSessionForUser(env.DB, user.id, request.headers.get('user-agent'), secure);
    const target = safeRedirect(oauthState.redirect);
    const response = new Response(null, { status: 302, headers: { location: target } });
    response.headers.append('set-cookie', cookie);
    response.headers.append('set-cookie', clearOauthCookie);
    return response;
  } catch (error) {
    console.error('[cf-email-groups] GitHub OAuth failed', error);
    const reason = error instanceof HttpError ? error.message : 'oauth_failed';
    return fail(reason);
  }
});
