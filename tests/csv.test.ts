import { describe, expect, it } from 'vitest';
import { extractSubscriberRows, parseCsv, toCsv } from '../src/lib/csv';

describe('parseCsv', () => {
  it('handles quoted commas, quotes and newlines', () => {
    const rows = parseCsv('email,name\n"a@x.com","Doe, Jane"\n"b@x.com","O""Brien"\n"c@x.com","multi\nline"');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual(['a@x.com', 'Doe, Jane']);
    expect(rows[2]).toEqual(['b@x.com', 'O"Brien']);
    expect(rows[3]).toEqual(['c@x.com', 'multi\nline']);
  });
});

describe('extractSubscriberRows', () => {
  it('finds email and name columns case-insensitively', () => {
    const parsed = extractSubscriberRows([
      ['Email', 'Full Name'],
      ['Ada@Example.com', 'Ada Lovelace'],
      ['not-an-email', 'Nope'],
    ]);
    expect(parsed.rows).toEqual([{ email: 'ada@example.com', name: 'Ada Lovelace' }]);
    expect(parsed.invalid).toBe(1);
  });

  it('supports headerless email,name files', () => {
    const parsed = extractSubscriberRows([['a@x.com', 'Ada'], ['b@x.com', '']]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]).toEqual({ email: 'b@x.com', name: null });
  });
});

describe('toCsv', () => {
  it('quotes fields containing separators', () => {
    expect(toCsv([['a@x.com', 'Doe, Jane'], ['b@x.com', 'plain']])).toBe(
      'a@x.com,"Doe, Jane"\r\nb@x.com,plain',
    );
  });
});
