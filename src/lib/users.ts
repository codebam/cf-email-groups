import { execute, queryAll, queryOne } from './db';
import { newId } from './ids';
import { userRowToSessionUser } from './sessions';
import type { SessionUser, UserRow } from './types';

export interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export async function upsertGitHubUser(db: D1Database, profile: GitHubProfile): Promise<UserRow> {
  const now = new Date().toISOString();
  await execute(
    db,
    `INSERT INTO users (id, github_id, github_login, name, email, avatar_url, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(github_id) DO UPDATE SET
       github_login = excluded.github_login,
       name = excluded.name,
       email = excluded.email,
       avatar_url = excluded.avatar_url,
       last_login_at = excluded.last_login_at`,
    newId(),
    profile.id,
    profile.login,
    profile.name,
    profile.email,
    profile.avatar_url,
    now,
    now,
  );
  const row = await queryOne<UserRow>(db, 'SELECT * FROM users WHERE github_id = ?', profile.id);
  if (!row) throw new Error('Failed to upsert user');
  return row;
}

/**
 * Turns pending GitHub-login invites into real memberships. Called on every
 * sign-in so invited admins are attached the first time they log in.
 */
export async function linkPendingInvites(db: D1Database, user: UserRow): Promise<number> {
  const invites = await queryAll<{ group_id: string; role: string }>(
    db,
    'SELECT group_id, role FROM admin_invites WHERE github_login = ? COLLATE NOCASE',
    user.github_login,
  );
  if (invites.length === 0) return 0;
  const now = new Date().toISOString();
  for (const invite of invites) {
    const role = invite.role === 'owner' ? 'owner' : 'admin';
    if (role === 'owner') {
      // Ownership transfer: demote the previous owner and clear other invites.
      await execute(db, "UPDATE group_admins SET role = 'admin' WHERE group_id = ? AND role = 'owner'", invite.group_id);
      await execute(db, 'DELETE FROM admin_invites WHERE group_id = ?', invite.group_id);
    } else {
      await execute(db, 'DELETE FROM admin_invites WHERE group_id = ? AND github_login = ? COLLATE NOCASE', invite.group_id, user.github_login);
    }
    await execute(
      db,
      `INSERT INTO group_admins (group_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(group_id, user_id) DO UPDATE SET role = excluded.role`,
      invite.group_id,
      user.id,
      role,
      now,
    );
  }
  return invites.length;
}

export { userRowToSessionUser };
export type { SessionUser };
