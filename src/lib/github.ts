import { HttpError } from './http';
import type { GitHubProfile } from './users';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_URL = 'https://api.github.com';

export function githubAuthorizeUrl(options: {
  clientId: string;
  callbackUrl: string;
  state: string;
  scope?: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.callbackUrl);
  url.searchParams.set('scope', options.scope ?? 'read:user user:email');
  url.searchParams.set('state', options.state);
  url.searchParams.set('allow_signup', 'true');
  return url.toString();
}

export async function exchangeCodeForToken(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  callbackUrl: string;
}): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: options.callbackUrl,
    }),
  });
  const text = await response.text();
  let data: Record<string, unknown>;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(502, 'GitHub returned an unexpected token response.');
  }
  if (!response.ok) {
    throw new HttpError(502, `GitHub sign-in failed (${response.status}).`);
  }
  if (typeof data.error === 'string') {
    throw new HttpError(502, `GitHub sign-in failed: ${data.error_description ?? data.error}`);
  }
  if (typeof data.access_token !== 'string') {
    throw new HttpError(502, 'GitHub did not return an access token.');
  }
  return data.access_token;
}

export async function fetchGitHubProfile(accessToken: string): Promise<GitHubProfile> {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'cf-email-groups',
    'x-github-api-version': '2022-11-28',
  };
  const response = await fetch(`${API_URL}/user`, { headers });
  if (!response.ok) throw new HttpError(502, `Could not load your GitHub profile (${response.status}).`);
  const profile = (await response.json()) as GitHubProfile & { email?: string | null };

  let email = profile.email ?? null;
  if (!email) {
    // The address may be private; ask for the primary verified address.
    const emailResponse = await fetch(`${API_URL}/user/emails`, { headers });
    if (emailResponse.ok) {
      const emails = (await emailResponse.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary = emails.find((entry) => entry.primary && entry.verified) ?? emails.find((entry) => entry.verified);
      email = primary?.email ?? null;
    }
  }

  return {
    id: profile.id,
    login: profile.login,
    name: profile.name ?? null,
    email,
    avatar_url: profile.avatar_url ?? null,
  };
}
