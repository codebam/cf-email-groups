import { useEffect, useState } from 'preact/hooks';
import type { PublicGroup } from '../lib/types';
import { api } from './api';
import { Field, Spinner } from './ui';

interface Props {
  slug: string;
  group: PublicGroup;
  siteKey: string | null;
}

interface SubscribeResult {
  ok: boolean;
  requiresConfirmation: boolean;
  existed: boolean;
  warning?: string;
}

export default function SignupForm({ slug, group, siteKey }: Props) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubscribeResult | null>(null);

  useEffect(() => {
    if (!siteKey || !group.requiresTurnstile) return;
    if (document.querySelector('script[data-cf-turnstile]')) return;
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    script.dataset.cfTurnstile = '1';
    document.head.appendChild(script);
  }, [siteKey, group.requiresTurnstile]);

  const submit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const turnstile = (window as unknown as { turnstile?: { getResponse?: () => string } }).turnstile;
      const token = group.requiresTurnstile ? turnstile?.getResponse?.() : undefined;
      if (group.requiresTurnstile && !token) {
        throw new Error('Please complete the verification challenge.');
      }
      const response = await api<SubscribeResult>('/api/public/subscribe', {
        method: 'POST',
        body: { slug, email, name, website, turnstileToken: token },
      });
      setResult(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div class="card card-body center">
        <div style="font-size:2.2rem" aria-hidden="true">
          {result.requiresConfirmation ? '📬' : '🎉'}
        </div>
        <h2>{result.requiresConfirmation ? 'Check your inbox' : "You're subscribed!"}</h2>
        <p class="muted">
          {result.requiresConfirmation
            ? `We sent a confirmation link to ${email}. Click it and you're on the list.`
            : `${email} is now subscribed to ${group.name}.`}
        </p>
        {result.warning ? <div class="alert alert-warning">The email couldn't be sent: {result.warning}</div> : null}
        <p class="muted small">Didn't get it? Check spam, or try again in a few minutes.</p>
      </div>
    );
  }

  return (
    <form class="card card-body" onSubmit={submit}>
      <h2 style="margin-bottom:0.25rem">Join {group.name}</h2>
      {group.description ? <p class="muted">{group.description}</p> : null}
      <p class="muted small">
        {group.doubleOptIn
          ? "We'll send a confirmation email first. No spam, and you can unsubscribe at any time."
          : 'Enter your email to subscribe. You can unsubscribe at any time.'}
      </p>

      {error ? <div class="alert alert-error">{error}</div> : null}

      <Field label="Email address" required>
        <input
          class="input"
          type="email"
          required
          autoComplete="email"
          value={email}
          onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
          placeholder="you@example.com"
        />
      </Field>
      <Field label="Name" hint="Optional — helps get to know you.">
        <input
          class="input"
          value={name}
          maxLength={120}
          autoComplete="name"
          onInput={(event) => setName((event.target as HTMLInputElement).value)}
        />
      </Field>

      {/* Honeypot: hidden from humans, tempting to bots. */}
      <div style="position:absolute;left:-9999px" aria-hidden="true">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onInput={(event) => setWebsite((event.target as HTMLInputElement).value)} />
        </label>
      </div>

      {group.requiresTurnstile && siteKey ? <div class="cf-turnstile" data-sitekey={siteKey} data-theme="auto" style="margin-bottom:1rem" /> : null}

      <button type="submit" class="btn btn-block" disabled={busy}>
        {busy ? <Spinner /> : null}
        Subscribe
      </button>
      <p class="muted small center" style="margin:0.9rem 0 0">
        By subscribing you agree to receive emails from {group.name}. Unsubscribe any time.
      </p>
    </form>
  );
}
