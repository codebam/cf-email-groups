import { render } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import SignupForm from '../src/components/SignupForm';

describe('SSR rendering', () => {
  it('renders the signup form', () => {
    const html = render(
      <SignupForm
        slug="seanbehan"
        group={{ name: 'Sean Behan', slug: 'seanbehan', description: 'News', doubleOptIn: true, requiresTurnstile: false, turnstileSiteKey: null }}
        siteKey={null}
      />,
    );
    expect(html).toContain('Join Sean Behan');
  });
});
