import { cleanInline } from './text';

// Per-subscriber tokens for campaign subjects and bodies.
//
// Supported tokens are case-insensitive and tolerate spaces inside the braces:
//   {{name}}       full subscriber name, or "there" when missing
//   {{first_name}} first word of the name, or "there"
//   {{email}}      subscriber email
//
// Unknown tokens are left verbatim so a typo is visible instead of silently
// turning into an empty string.

export interface MergeData {
  name?: string | null;
  email?: string | null;
}

export const SAMPLE_SUBSCRIBER: { name: string; email: string } = {
  name: 'Alex Example',
  email: 'alex@example.com',
};

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function tokenValues(data: MergeData): Record<string, string> {
  const name = cleanInline(data.name);
  const firstName = name ? name.split(/\s+/)[0]! : '';
  return {
    name: name || 'there',
    first_name: firstName || 'there',
    email: cleanInline(data.email),
  };
}

/** Replaces supported `{{token}}` placeholders with values for one subscriber. */
export function personalize(text: string, data: MergeData): string {
  const values = tokenValues(data);
  return text.replace(TOKEN_PATTERN, (match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : match;
  });
}
