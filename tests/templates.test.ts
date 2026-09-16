import { describe, expect, it } from 'vitest';
import { campaignEmail, confirmEmail, welcomeEmail } from '../src/lib/templates';

const group = { name: 'Test <List>', description: 'A list', from_name: '', from_email: '' } as never;
const subscriber = { email: 'a@example.com', name: 'Ada', unsubscribe_token: 'tok' } as never;

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

  it('renders campaign markdown and personalizes the unsubscribe link', () => {
    const email = campaignEmail({
      group,
      campaign: { subject: 'Hello', body_md: '# Update\n\nRead **this**.' } as never,
      subscriber,
      unsubscribeUrl: 'https://app.example/unsubscribe?token=tok',
    });
    expect(email.subject).toBe('Hello');
    expect(email.html).toContain('<h1');
    expect(email.html).toContain('<strong>this</strong>');
    expect(email.html).toContain('https://app.example/unsubscribe?token=tok');
  });
});
