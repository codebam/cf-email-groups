import { describe, expect, it } from 'vitest';
import { allowedGitHubLogins, isLoginAllowed, singleListConfig } from '../src/lib/single';

describe('singleListConfig', () => {
  it('is disabled unless SINGLE_LIST=1', () => {
    expect(singleListConfig({})).toBeNull();
    expect(singleListConfig({ SINGLE_LIST: '0' })).toBeNull();
  });

  it('provides sensible defaults for this deployment', () => {
    expect(singleListConfig({ SINGLE_LIST: '1' })).toEqual({
      slug: 'seanbehan',
      name: 'My mailing list',
      description: '',
    });
  });

  it('slugifies raw input and trims name/description', () => {
    const config = singleListConfig({
      SINGLE_LIST: '1',
      SINGLE_LIST_SLUG: '  My Updates! ',
      SINGLE_LIST_NAME: '  Sean Behan  ',
      SINGLE_LIST_DESCRIPTION: '  Occasional updates.  ',
    });
    expect(config).toEqual({ slug: 'my-updates', name: 'Sean Behan', description: 'Occasional updates.' });
  });
});

describe('sign-in allow-list', () => {
  it('allows everyone when unset', () => {
    expect(allowedGitHubLogins({})).toEqual([]);
    expect(isLoginAllowed({}, 'anyone')).toBe(true);
  });

  it('parses, lowercases and strips @ from logins', () => {
    expect(allowedGitHubLogins({ ALLOWED_GITHUB_LOGINS: ' CodeBam, alice ' })).toEqual(['codebam', 'alice']);
    expect(isLoginAllowed({ ALLOWED_GITHUB_LOGINS: 'codebam' }, '@CodeBam')).toBe(true);
    expect(isLoginAllowed({ ALLOWED_GITHUB_LOGINS: 'codebam' }, 'someone-else')).toBe(false);
  });
});
