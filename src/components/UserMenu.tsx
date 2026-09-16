import { useEffect, useRef, useState } from 'preact/hooks';
import type { SessionUser } from '../lib/types';
import { api } from './api';

export default function UserMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const signOut = async () => {
    setBusy(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Signing out locally is the best we can do.
    }
    window.location.href = '/';
  };

  return (
    <div ref={ref} class="user-menu">
      <button type="button" class="user-menu-button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {user.avatarUrl ? <img class="avatar" src={user.avatarUrl} alt="" /> : <span class="avatar avatar-fallback">{user.login.slice(0, 1).toUpperCase()}</span>}
        <span class="user-login">{user.login}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div class="user-dropdown">
          <div class="user-dropdown-header">
            <strong>{user.name || user.login}</strong>
            <span class="muted small">{user.email || 'GitHub account'}</span>
          </div>
          <a class="user-dropdown-item" href="/app">
            Dashboard
          </a>
          <button type="button" class="user-dropdown-item" onClick={signOut} disabled={busy}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
