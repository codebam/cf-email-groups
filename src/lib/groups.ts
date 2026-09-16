import { boolToInt, execute, queryAll, queryOne } from './db';
import { HttpError } from './http';
import { isValidEmail } from './csv';
import type { AppBindings } from './config';
import { newId, nextSlugCandidate, isValidSlug, slugify } from './ids';
import { allowedGitHubLogins, singleListConfig } from './single';
import type {
  GroupAdmin,
  GroupDetail,
  GroupRole,
  GroupRow,
  GroupSummary,
  SessionUser,
  SubscriberStatus,
  UserRow,
} from './types';

const STATUS_ORDER: SubscriberStatus[] = ['pending', 'active', 'unsubscribed', 'bounced', 'complained'];

export function emptyCounts(): Record<SubscriberStatus, number> {
  return { pending: 0, active: 0, unsubscribed: 0, bounced: 0, complained: 0 };
}

export function groupRowToDetail(
  row: GroupRow,
  role: GroupRole,
  counts: Record<SubscriberStatus, number>,
): GroupDetail {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    fromName: row.from_name,
    fromEmail: row.from_email,
    replyTo: row.reply_to,
    doubleOptIn: row.double_opt_in === 1,
    publicSignup: row.public_signup === 1,
    role,
    createdAt: row.created_at,
    counts,
  };
}

export async function getGroup(db: D1Database, idOrSlug: string): Promise<GroupRow | null> {
  return queryOne<GroupRow>(db, 'SELECT * FROM groups WHERE id = ? OR slug = ? COLLATE NOCASE', idOrSlug, idOrSlug);
}

export async function getGroupBySlug(db: D1Database, slug: string): Promise<GroupRow | null> {
  return queryOne<GroupRow>(db, 'SELECT * FROM groups WHERE slug = ? COLLATE NOCASE', slug);
}

export async function getMembership(db: D1Database, groupId: string, userId: string): Promise<GroupRole | null> {
  const row = await queryOne<{ role: string }>(
    db,
    'SELECT role FROM group_admins WHERE group_id = ? AND user_id = ?',
    groupId,
    userId,
  );
  if (!row) return null;
  return row.role === 'owner' ? 'owner' : 'admin';
}

export async function requireMembership(
  db: D1Database,
  groupIdOrSlug: string,
  user: SessionUser,
  needed: GroupRole,
): Promise<{ group: GroupRow; role: GroupRole }> {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new HttpError(404, 'List not found.');
  const role = await getMembership(db, group.id, user.id);
  if (!role) throw new HttpError(404, 'List not found.');
  if (needed === 'owner' && role !== 'owner') throw new HttpError(403, 'Only the list owner can do that.');
  return { group, role };
}

export async function countsByStatus(db: D1Database, groupId: string): Promise<Record<SubscriberStatus, number>> {
  const rows = await queryAll<{ status: SubscriberStatus; count: number }>(
    db,
    'SELECT status, COUNT(*) AS count FROM subscribers WHERE group_id = ? GROUP BY status',
    groupId,
  );
  const counts = emptyCounts();
  for (const row of rows) {
    if (STATUS_ORDER.includes(row.status)) counts[row.status] = Number(row.count);
  }
  return counts;
}

export async function listGroupsForUser(db: D1Database, userId: string): Promise<GroupSummary[]> {
  const rows = await queryAll<GroupRow & { role: string; total_count: number; active_count: number; pending_count: number }>(
    db,
    `SELECT g.*, ga.role,
       (SELECT COUNT(*) FROM subscribers s WHERE s.group_id = g.id) AS total_count,
       (SELECT COUNT(*) FROM subscribers s WHERE s.group_id = g.id AND s.status = 'active') AS active_count,
       (SELECT COUNT(*) FROM subscribers s WHERE s.group_id = g.id AND s.status = 'pending') AS pending_count
     FROM groups g
     JOIN group_admins ga ON ga.group_id = g.id
     WHERE ga.user_id = ?
     ORDER BY g.created_at DESC`,
    userId,
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    role: row.role === 'owner' ? 'owner' : 'admin',
    totalCount: Number(row.total_count),
    activeCount: Number(row.active_count),
    pendingCount: Number(row.pending_count),
  }));
}

async function uniqueSlug(db: D1Database, base: string): Promise<string> {
  const seed = isValidSlug(base) ? base : slugify(base) || 'list';
  for (let attempt = 1; attempt <= 60; attempt++) {
    const candidate = nextSlugCandidate(seed, attempt);
    const existing = await queryOne<{ id: string }>(db, 'SELECT id FROM groups WHERE slug = ? COLLATE NOCASE', candidate);
    if (!existing) return candidate;
  }
  return `${nextSlugCandidate(seed, 61)}-${newId().slice(0, 8)}`.slice(0, 64);
}

export interface CreateGroupInput {
  name: string;
  slug?: string;
  description?: string;
}

export async function createGroup(db: D1Database, user: SessionUser, input: CreateGroupInput): Promise<GroupRow> {
  const name = input.name.trim();
  if (name.length < 2) throw new HttpError(400, 'List name must be at least 2 characters.');
  const slug = await uniqueSlug(db, (input.slug || input.name).trim());
  const now = new Date().toISOString();
  const id = newId();
  try {
    await execute(
      db,
      `INSERT INTO groups (id, slug, name, description, from_name, from_email, reply_to, double_opt_in, public_signup, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', '', 1, 1, ?, ?, ?)`,
      id,
      slug,
      name,
      (input.description ?? '').trim(),
      name,
      user.id,
      now,
      now,
    );
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new HttpError(409, 'That slug is already taken.');
    throw error;
  }
  await execute(
    db,
    'INSERT INTO group_admins (group_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    id,
    user.id,
    'owner',
    now,
  );
  const group = await getGroup(db, id);
  if (!group) throw new Error('Failed to create list');
  return group;
}

export interface UpdateGroupInput {
  name?: string;
  description?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  doubleOptIn?: boolean;
  publicSignup?: boolean;
}

export async function updateGroup(db: D1Database, group: GroupRow, input: UpdateGroupInput): Promise<GroupRow> {
  if (input.fromEmail !== undefined && input.fromEmail !== '' && !isValidEmail(input.fromEmail)) {
    throw new HttpError(400, 'From email is not a valid address.');
  }
  if (input.replyTo !== undefined && input.replyTo !== '' && !isValidEmail(input.replyTo)) {
    throw new HttpError(400, 'Reply-to is not a valid address.');
  }
  const fields: string[] = [];
  const values: Array<string | number> = [];
  const set = (column: string, value: string | number) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2) throw new HttpError(400, 'List name must be at least 2 characters.');
    set('name', name);
  }
  if (input.description !== undefined) set('description', input.description.trim().slice(0, 2000));
  if (input.fromName !== undefined) set('from_name', input.fromName.trim().slice(0, 120));
  if (input.fromEmail !== undefined) set('from_email', input.fromEmail.trim().toLowerCase().slice(0, 254));
  if (input.replyTo !== undefined) set('reply_to', input.replyTo.trim().toLowerCase().slice(0, 254));
  if (input.doubleOptIn !== undefined) set('double_opt_in', boolToInt(input.doubleOptIn));
  if (input.publicSignup !== undefined) set('public_signup', boolToInt(input.publicSignup));
  if (fields.length === 0) return group;
  set('updated_at', new Date().toISOString());
  values.push(group.id);
  await execute(db, `UPDATE groups SET ${fields.join(', ')} WHERE id = ?`, ...values);
  const updated = await getGroup(db, group.id);
  if (!updated) throw new HttpError(404, 'List not found.');
  return updated;
}

export async function deleteGroup(db: D1Database, groupId: string): Promise<void> {
  await execute(db, 'DELETE FROM groups WHERE id = ?', groupId);
}

export async function listAdmins(db: D1Database, groupId: string): Promise<GroupAdmin[]> {
  const rows = await queryAll<{
    user_id: string | null;
    login: string;
    name: string | null;
    avatar_url: string | null;
    role: string;
    pending: number;
  }>(
    db,
    `SELECT ga.user_id, u.github_login AS login, u.name, u.avatar_url, ga.role, 0 AS pending
       FROM group_admins ga JOIN users u ON u.id = ga.user_id
      WHERE ga.group_id = ?
      UNION ALL
      SELECT NULL AS user_id, ai.github_login AS login, NULL AS name, NULL AS avatar_url, ai.role, 1 AS pending
       FROM admin_invites ai
      WHERE ai.group_id = ?
      ORDER BY pending, role, login COLLATE NOCASE`,
    groupId,
    groupId,
  );
  return rows.map((row) => ({
    userId: row.user_id ?? '',
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,
    role: row.role === 'owner' ? 'owner' : 'admin',
    pending: row.pending === 1,
  }));
}

const LOGIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

export async function addGroupAdmin(
  db: D1Database,
  groupId: string,
  actor: SessionUser,
  loginInput: string,
  role: GroupRole,
): Promise<{ pending: boolean; login: string }> {
  const login = loginInput.trim().replace(/^@/, '');
  if (!LOGIN_RE.test(login)) throw new HttpError(400, 'Enter a valid GitHub username.');
  if (login.toLowerCase() === actor.login.toLowerCase()) throw new HttpError(400, "You're already an admin of this list.");

  const user = await queryOne<UserRow>(db, 'SELECT * FROM users WHERE github_login = ? COLLATE NOCASE', login);
  const now = new Date().toISOString();

  if (!user) {
    await execute(
      db,
      `INSERT INTO admin_invites (group_id, github_login, role, invited_by, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(group_id, github_login) DO UPDATE SET role = excluded.role`,
      groupId,
      login,
      role,
      actor.id,
      now,
    );
    // Existing pending invites must not be able to promote themselves.
    if (role === 'owner') {
      await execute(db, 'DELETE FROM admin_invites WHERE group_id = ? AND github_login <> ? COLLATE NOCASE', groupId, login);
    }
    return { pending: true, login };
  }

  if (role === 'owner') {
    await execute(db, "UPDATE group_admins SET role = 'admin' WHERE group_id = ? AND role = 'owner'", groupId);
    await execute(db, 'DELETE FROM admin_invites WHERE group_id = ?', groupId);
  }
  await execute(
    db,
    `INSERT INTO group_admins (group_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(group_id, user_id) DO UPDATE SET role = excluded.role`,
    groupId,
    user.id,
    role,
    now,
  );
  return { pending: false, login: user.github_login };
}

export async function removeGroupAdmin(
  db: D1Database,
  groupId: string,
  targetUserId: string,
): Promise<void> {
  const target = await queryOne<{ role: string }>(
    db,
    'SELECT role FROM group_admins WHERE group_id = ? AND user_id = ?',
    groupId,
    targetUserId,
  );
  if (!target) throw new HttpError(404, 'That admin was not found.');
  if (target.role === 'owner') {
    throw new HttpError(400, 'Transfer ownership to another admin before removing the owner.');
  }
  await execute(db, 'DELETE FROM group_admins WHERE group_id = ? AND user_id = ?', groupId, targetUserId);
}

export async function removeInvite(db: D1Database, groupId: string, login: string): Promise<void> {
  await execute(db, 'DELETE FROM admin_invites WHERE group_id = ? AND github_login = ? COLLATE NOCASE', groupId, login);
}

export async function getGroupForUserBySlug(
  db: D1Database,
  slug: string,
  userId: string,
): Promise<{ group: GroupRow; role: GroupRole } | null> {
  const group = await getGroupBySlug(db, slug);
  if (!group) return null;
  const role = await getMembership(db, group.id, userId);
  if (!role) return null;
  return { group, role };
}

/** Looks a list up by id or slug, then checks that `userId` is a member. */
export async function getGroupForUser(
  db: D1Database,
  idOrSlug: string,
  userId: string,
): Promise<{ group: GroupRow; role: GroupRole } | null> {
  const group = await getGroup(db, idOrSlug);
  if (!group) return null;
  const role = await getMembership(db, group.id, userId);
  if (!role) return null;
  return { group, role };
}


/**
 * Single-list deployments auto-create their one list on first use, so the
 * public sign-up page works before the owner has ever signed in.
 */
export async function ensureSingleList(db: D1Database, env: AppBindings): Promise<GroupRow | null> {
  const config = singleListConfig(env);
  if (!config) return null;
  const existing = await getGroupBySlug(db, config.slug);
  if (existing) return existing;

  const now = new Date().toISOString();
  try {
    await execute(
      db,
      `INSERT INTO groups (id, slug, name, description, from_name, from_email, reply_to, double_opt_in, public_signup, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', '', 1, 1, NULL, ?, ?)`,
      newId(),
      config.slug,
      config.name,
      config.description,
      config.name,
      now,
      now,
    );
  } catch (error) {
    // A concurrent request may have created it first.
    if (!String(error).includes('UNIQUE')) throw error;
  }
  return getGroupBySlug(db, config.slug);
}

/**
 * Ensures a signed-in, allow-listed user is a member of the single list.
 * The preferred owner is the first entry in ALLOWED_GITHUB_LOGINS (if set);
 * everyone else joins as an admin.
 */
export async function ensureSingleListMembership(
  db: D1Database,
  env: AppBindings,
  user: SessionUser,
): Promise<{ group: GroupRow; role: GroupRole } | null> {
  const config = singleListConfig(env);
  if (!config) return null;
  const group = await ensureSingleList(db, env);
  if (!group) return null;

  const existingRole = await getMembership(db, group.id, user.id);
  if (existingRole) return { group, role: existingRole };

  const owner = await queryOne<{ user_id: string }>(
    db,
    "SELECT user_id FROM group_admins WHERE group_id = ? AND role = 'owner' LIMIT 1",
    group.id,
  );
  const preferredOwner = allowedGitHubLogins(env)[0];
  const canClaimOwner = !owner && (!preferredOwner || preferredOwner === user.login.toLowerCase());
  const now = new Date().toISOString();

  if (canClaimOwner) {
    // Atomic-ish claim: only succeeds while no owner exists.
    const claim = await db
      .prepare(
        `INSERT INTO group_admins (group_id, user_id, role, created_at)
         SELECT ?, ?, 'owner', ?
         WHERE NOT EXISTS (SELECT 1 FROM group_admins WHERE group_id = ? AND role = 'owner')`,
      )
      .bind(group.id, user.id, now, group.id)
      .run();
    if ((claim.meta?.changes ?? 0) > 0) return { group, role: 'owner' };
  }

  await execute(
    db,
    `INSERT INTO group_admins (group_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)
     ON CONFLICT(group_id, user_id) DO NOTHING`,
    group.id,
    user.id,
    now,
  );
  const role = (await getMembership(db, group.id, user.id)) ?? 'admin';
  return { group, role };
}
