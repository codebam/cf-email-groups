import { appOrigin, getEnv } from '../../../lib/config';
import { githubAuthorizeUrl } from '../../../lib/github';
import { api } from '../../../lib/http';
import { randomToken, safeRedirect } from '../../../lib/ids';

export const GET = api(async ({ request, url, cookies }) => {
  const env = getEnv();
  const secure = url.protocol === 'https:';
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return new Response(null, {
      status: 302,
      headers: { location: '/login?error=github_not_configured' },
    });
  }

  const redirect = safeRedirect(url.searchParams.get('redirect'));
  const state = randomToken(24);
  const callbackUrl = `${appOrigin(request, env)}/api/auth/github/callback`;
  cookies.set('eg_oauth', JSON.stringify({ state, redirect }), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 600,
  });

  return new Response(null, {
    status: 302,
    headers: {
      location: githubAuthorizeUrl({
        clientId: env.GITHUB_CLIENT_ID,
        callbackUrl,
        state,
      }),
    },
  });
});
