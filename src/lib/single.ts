// Single-list mode: a deployment dedicated to exactly one mailing list.
// Pure config parsing so it can be unit-tested without the Workers runtime.
import type { AppBindings } from './config';
import { slugify } from './ids';

export interface SingleListConfig {
  slug: string;
  name: string;
  description: string;
}

export function allowedGitHubLogins(env: Pick<AppBindings, 'ALLOWED_GITHUB_LOGINS'>): string[] {
  return (env.ALLOWED_GITHUB_LOGINS ?? '')
    .split(',')
    .map((login) => login.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

export function isLoginAllowed(env: Pick<AppBindings, 'ALLOWED_GITHUB_LOGINS'>, login: string): boolean {
  const allowed = allowedGitHubLogins(env);
  if (allowed.length === 0) return true;
  return allowed.includes(login.trim().toLowerCase().replace(/^@/, ''));
}

export function singleListConfig(
  env: Pick<AppBindings, 'SINGLE_LIST' | 'SINGLE_LIST_SLUG' | 'SINGLE_LIST_NAME' | 'SINGLE_LIST_DESCRIPTION'>,
): SingleListConfig | null {
  if (env.SINGLE_LIST !== '1') return null;
  const slug = slugify(env.SINGLE_LIST_SLUG || 'seanbehan') || 'seanbehan';
  return {
    slug,
    name: (env.SINGLE_LIST_NAME || 'My mailing list').trim().slice(0, 120),
    description: (env.SINGLE_LIST_DESCRIPTION || '').trim().slice(0, 2000),
  };
}
