import { describe, expect, it } from 'vitest';
import { nextSlugCandidate, randomToken, safeRedirect, sha256Hex, slugify } from '../src/lib/ids';

describe('slugify', () => {
  it('normalizes names', () => {
    expect(slugify('  Héllo, Wörld!  ')).toBe('hello-world');
    expect(slugify('a--b')).toBe('a-b');
    expect(slugify('!!!')).toBe('');
  });
});

describe('nextSlugCandidate', () => {
  it('adds a numeric suffix for collisions', () => {
    expect(nextSlugCandidate('My List', 1)).toBe('my-list');
    expect(nextSlugCandidate('My List', 2)).toBe('my-list-2');
  });

  it('keeps the result within 63 characters', () => {
    const long = 'x'.repeat(80);
    expect(nextSlugCandidate(long, 12).length).toBeLessThanOrEqual(63);
  });
});

describe('safeRedirect', () => {
  it('allows only local paths', () => {
    expect(safeRedirect('/app/groups/x')).toBe('/app/groups/x');
    expect(safeRedirect('https://evil.example')).toBe('/app');
    expect(safeRedirect('//evil.example')).toBe('/app');
    expect(safeRedirect(null)).toBe('/app');
  });
});

describe('tokens', () => {
  it('produces URL-safe random tokens of the expected size', () => {
    const token = randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(42);
    expect(randomToken(32)).not.toBe(token);
  });

  it('hashes deterministically', async () => {
    expect(await sha256Hex('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});
