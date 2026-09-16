import { describe, expect, it } from 'vitest';
import { personalize, tokenValues } from '../src/lib/personalize';

describe('personalize', () => {
  it('replaces name, first_name and email tokens', () => {
    const data = { name: 'Ada Lovelace', email: 'ada@example.com' };
    expect(personalize('Hi {{name}} ({{first_name}} <{{email}}>)', data)).toBe(
      'Hi Ada Lovelace (Ada <ada@example.com>)',
    );
  });

  it('is case-insensitive and tolerates spaces inside the braces', () => {
    expect(personalize('{{ NAME }} / {{  First_Name  }}', { name: 'Grace Hopper', email: 'g@example.com' })).toBe(
      'Grace Hopper / Grace',
    );
  });

  it('falls back to "there" when the subscriber has no name', () => {
    expect(personalize('Hi {{name}} / {{first_name}}', { name: null, email: 'anon@example.com' })).toBe(
      'Hi there / there',
    );
    expect(personalize('Hi {{name}}', { name: '   ', email: 'anon@example.com' })).toBe('Hi there');
  });

  it('leaves unknown or malformed tokens untouched', () => {
    expect(personalize('{{name}} {{surname}} {{}}', { name: 'Ada', email: 'ada@example.com' })).toBe(
      'Ada {{surname}} {{}}',
    );
  });

  it('strips CR/LF and control characters from subscriber-supplied values', () => {
    expect(personalize('{{name}}', { name: 'Ada\r\nBcc: evil@example.com', email: 'ada@example.com' })).toBe(
      'Ada Bcc: evil@example.com',
    );
    expect(tokenValues({ email: 'a\u0000b@example.com' }).email).toBe('a b@example.com');
  });
});
