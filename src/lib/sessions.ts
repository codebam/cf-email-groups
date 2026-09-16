import { execute, queryOne } from './db';
import { parseCookies, serializeCookie } from './http';
import { newId, randomToken, sha256Hex } from './ids';
import type { SessionUser, UserRow } from './types';

export const SESSION_COOKIE = 'eg_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function userRowToSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    login: row.github_login,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
  };
}

export async function createSession(
  db: D1Database,
  userId: string,
  userAgent: string | null,
): Promise<{ token: string; maxAge: number }> {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  await execute(
    db,
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    id,
    userId,
    now.toISOString(),
    expiresAt,
    userAgent,
  );
  // Opportunistic cleanup; cheap because of the expires_at index.
  await execute(db, 'DELETE FROM sessions WHERE expires_at <= ?', now.toISOString());
  return { token, maxAge: SESSION_TTL_SECONDS };
}

export function sessionCookie(token: string, maxAge: number, secure: boolean): string {
  return serializeCookie(SESSION_COOKIE, token, { maxAge, secure, httpOnly: true, sameSite: 'Lax', path: '/' });
}

export function clearSessionCookie(secure: boolean): string {
  return serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure, httpOnly: true, sameSite: 'Lax', path: '/' });
}

export async function getUserFromRequest(request: Request, db: D1Database): Promise<SessionUser | null> {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await queryOne<UserRow>(
    db,
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
    id,
    new Date().toISOString(),
  );
  return row ? userRowToSessionUser(row) : null;
}

export async function destroySession(request: Request, db: D1Database): Promise<void> {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token) return;
  const id = await sha256Hex(token);
  await execute(db, 'DELETE FROM sessions WHERE id = ?', id);
}

export async function createSessionForUser(
  db: D1Database,
  userId: string,
  userAgent: string | null,
  secure: boolean,
): Promise<string> {
  const { token, maxAge } = await createSession(db, userId, userAgent);
  return sessionCookie(token, maxAge, secure);
}

export async function deleteUserSessions(db: D1Database, userId: string): Promise<void> {
  await execute(db, 'DELETE FROM sessions WHERE user_id = ?', userId);
}

export { newId };
