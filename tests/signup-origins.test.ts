import { describe, expect, it } from 'vitest';
import {
  isAllowedSignupOrigin,
  normalizeOrigin,
  parseAllowedSignupOrigins,
  resolveSafeNext,
  subscribeFallbackPath,
  withSignupResult,
} from '../src/lib/signup-origins';

const REQUEST_ORIGIN = 'https://lists.seanbehan.ca';
const policy = {
  requestOrigin: REQUEST_ORIGIN,
  allowedOrigins: parseAllowedSignupOrigins({
    ALLOWED_SIGNUP_ORIGINS: 'https://seanbehan.ca, https://codebam.ca, https://seanbehan.ca:443',
  }),
};

describe('parseAllowedSignupOrigins', () => {
  it('normalizes comma-separated origins and drops duplicates/default ports', () => {
    expect([...policy.allowedOrigins].sort()).toEqual(['https://codebam.ca', 'https://seanbehan.ca']);
    expect(parseAllowedSignupOrigins({ ALLOWED_SIGNUP_ORIGINS: 'https://seanbehan.ca:443' })).toEqual(
      new Set(['https://seanbehan.ca']),
    );
  });

  it('ignores empty, wildcard, malformed, credentialed and non-http(s) entries', () => {
    const parsed = parseAllowedSignupOrigins({
      ALLOWED_SIGNUP_ORIGINS:
        ' , *, javascript:alert(1), https://user:pass@seanbehan.ca, //evil.example, https://codebam.ca, https://seanbehan.ca/path?q=1',
    });
    expect([...parsed]).toEqual(['https://codebam.ca']);
  });
});

describe('normalizeOrigin', () => {
  it('accepts only concrete http(s) origins', () => {
    expect(normalizeOrigin('https://seanbehan.ca')).toBe('https://seanbehan.ca');
    expect(normalizeOrigin(' https://seanbehan.ca:443 ')).toBe('https://seanbehan.ca');
    expect(normalizeOrigin('https://seanbehan.ca/')).toBe('https://seanbehan.ca');
    expect(normalizeOrigin('HTTPS://CodeBam.CA')).toBe('https://codebam.ca');
    expect(normalizeOrigin(null)).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
    expect(normalizeOrigin('null')).toBeNull();
    expect(normalizeOrigin('https://user:pass@seanbehan.ca')).toBeNull();
    expect(normalizeOrigin('ftp://seanbehan.ca')).toBeNull();
    expect(normalizeOrigin('https://seanbehan.ca/path')).toBeNull();
    expect(normalizeOrigin('https://seanbehan.ca?x=1')).toBeNull();
    expect(normalizeOrigin('not a url')).toBeNull();
  });
});

describe('resolveSafeNext', () => {
  it('returns same-origin paths unchanged', () => {
    expect(resolveSafeNext('/test-page?ref=form#top', policy)).toBe('/test-page?ref=form#top');
    expect(resolveSafeNext('/test page', policy)).toBe('/test%20page');
  });

  it('accepts absolute http(s) URLs on the request origin or allow-list', () => {
    expect(resolveSafeNext('https://seanbehan.ca/test-page', policy)).toBe('https://seanbehan.ca/test-page');
    expect(resolveSafeNext('https://lists.seanbehan.ca/confirm?x=1', policy)).toBe(
      'https://lists.seanbehan.ca/confirm?x=1',
    );
    expect(resolveSafeNext('https://codebam.ca:443/a', policy)).toBe('https://codebam.ca/a');
  });

  it('rejects protocol-relative, backslash and control-character targets', () => {
    expect(resolveSafeNext('//evil.example/steal', policy)).toBeNull();
    expect(resolveSafeNext('///evil.example/steal', policy)).toBeNull();
    expect(resolveSafeNext('\\evil.example/steal', policy)).toBeNull();
    expect(resolveSafeNext('/\\evil.example/steal', policy)).toBeNull();
    expect(resolveSafeNext('/test-page\nSet-Cookie:x', policy)).toBeNull();
    expect(resolveSafeNext('/test-page\r\nLocation: https://evil.example', policy)).toBeNull();
    expect(resolveSafeNext('\u0000/evil', policy)).toBeNull();
  });

  it('rejects non-http(s), userinfo bearing and unknown absolute origins', () => {
    expect(resolveSafeNext('javascript:alert(1)', policy)).toBeNull();
    expect(resolveSafeNext('data:text/html,hi', policy)).toBeNull();
    expect(resolveSafeNext('mailto:someone@example.com', policy)).toBeNull();
    expect(resolveSafeNext('https://user:pass@seanbehan.ca/steal', policy)).toBeNull();
    expect(resolveSafeNext('https://seanbehan.ca@evil.example/steal', policy)).toBeNull();
    expect(resolveSafeNext('https://seanbehan.ca.evil.example/', policy)).toBeNull();
    expect(resolveSafeNext('https://evil.example/', policy)).toBeNull();
    expect(resolveSafeNext('not a url', policy)).toBeNull();
    expect(resolveSafeNext(undefined, policy)).toBeNull();
  });

  it('rejects overly long next values', () => {
    expect(resolveSafeNext(`/${'a'.repeat(3000)}`, policy)).toBeNull();
  });
});

describe('redirect target helpers', () => {
  it('builds a slug-only fallback path', () => {
    expect(subscribeFallbackPath('seanbehan')).toBe('/join/seanbehan');
    expect(subscribeFallbackPath('../etc/passwd')).toBe('/join/etcpasswd');
    expect(subscribeFallbackPath('')).toBe('/');
    expect(subscribeFallbackPath(null)).toBe('/');
  });

  it('appends and replaces result params on relative and absolute targets', () => {
    expect(withSignupResult('/test-page?x=1', REQUEST_ORIGIN, { subscribed: 'confirm' })).toBe(
      '/test-page?x=1&subscribed=confirm',
    );
    expect(
      withSignupResult('/test-page?subscribed=done&subscribe_error=rate#top', REQUEST_ORIGIN, {
        subscribe_error: 'invalid',
      }),
    ).toBe('/test-page?subscribe_error=invalid#top');
    expect(withSignupResult('https://seanbehan.ca/test-page', REQUEST_ORIGIN, { subscribed: 'done' })).toBe(
      'https://seanbehan.ca/test-page?subscribed=done',
    );
  });
});

describe('isAllowedSignupOrigin', () => {
  it('matches exact normalized origins only', () => {
    expect(isAllowedSignupOrigin('https://seanbehan.ca', policy.allowedOrigins)).toBe(true);
    expect(isAllowedSignupOrigin('https://seanbehan.ca.evil.example', policy.allowedOrigins)).toBe(false);
    expect(isAllowedSignupOrigin(null, policy.allowedOrigins)).toBe(false);
  });
});
