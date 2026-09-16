import { describe, expect, it } from 'vitest';
import { campaignEmail, confirmEmail, testEmail, welcomeEmail } from '../src/lib/templates';

const group = { name: 'Test <List>', description: 'A list', from_name: '', from_email: '' } as never;
const subscriber = { email: 'a@example.com', name: 'Ada', unsubscribe_token: 'tok' };

describe('email templates', () => {
  it('includes the confirmation link and escapes the group name', () => {
    const email = confirmEmail({ group, subscriber, confirmUrl: 'https://app.example/confirm?token=abc' });
    expect(email.subject).toContain('Test <List>');
    expect(email.html).toContain('https://app.example/confirm?token=abc');
    expect(email.html).not.toContain('Test <List>');
    expect(email.html).toContain('Test &lt;List&gt;');
  });

  it('includes an unsubscribe link in welcome emails', () => {
    const email = welcomeEmail({ group, subscriber, unsubscribeUrl: 'https://app.example/unsubscribe?token=abc' });
    expect(email.html).toContain('https://app.example/unsubscribe?token=abc');
    expect(email.text).toContain('https://app.example/unsubscribe?token=abc');
  });

  it('renders campaign markdown, merge tokens and the personal unsubscribe link', () => {
    const email = campaignEmail({
      group,
      campaign: { subject: 'Hi {{name}}', body_md: '# Update\n\nHi {{name}}, read **this** at {{email}}.' } as never,
      subscriber,
      unsubscribeUrl: 'https://app.example/unsubscribe?token=tok',
    });
    expect(email.subject).toBe('Hi Ada');
    expect(email.html).toContain('<h1');
    expect(email.html).toContain('Hi Ada');
    expect(email.html).toContain('a@example.com');
    expect(email.html).toContain('<strong>this</strong>');
    expect(email.html).toContain('https://app.example/unsubscribe?token=tok');
    expect(email.text).toContain('Hi Ada');
  });

  it('falls back to "there" when a campaign subscriber has no name', () => {
    const email = campaignEmail({
      group,
      campaign: { subject: 'Hi {{name}}', body_md: 'Hi {{first_name}}!' } as never,
      subscriber: { ...subscriber, name: null } as never,
      unsubscribeUrl: 'https://app.example/unsubscribe?token=tok',
    });
    expect(email.subject).toBe('Hi there');
    expect(email.html).toContain('Hi there!');
  });

  it('escapes subscriber names before campaign HTML is rendered', () => {
    const email = campaignEmail({
      group,
      campaign: { subject: 'Hello {{name}}', body_md: 'Hello {{name}}' } as never,
      subscriber: { ...subscriber, name: '<script>alert(1)</script>' } as never,
      unsubscribeUrl: 'https://app.example/unsubscribe?token=tok',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('previews merge tokens with sample subscriber data in test sends', () => {
    const email = testEmail({ group, subject: 'Hi {{name}}', bodyMd: '{{first_name}} / {{email}}' });
    expect(email.subject).toBe('[Test] Hi Alex Example');
    expect(email.text).toContain('Alex / alex@example.com');
  });

  it('uses the test recipient address for the email token', () => {
    const email = testEmail({ group, subject: 'Hello', bodyMd: 'Reach me at {{email}}', subscriber: { email: 'me@example.com' } });
    expect(email.html).toContain('me@example.com');
  });
});
