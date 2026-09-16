import { getEnv } from '../../../../lib/config';
import { addGroupAdmin, listAdmins, removeInvite, requireMembership } from '../../../../lib/groups';
import { api, getString, json, readJson, requireUser } from '../../../../lib/http';

export const GET = api(async ({ locals, params }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group } = await requireMembership(env.DB, params.id!, user, 'admin');
  return json({ admins: await listAdmins(env.DB, group.id) });
});

export const POST = api(async ({ locals, params, request }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group, role } = await requireMembership(env.DB, params.id!, user, 'admin');
  const body = await readJson(request);
  const login = getString(body, 'login', { required: true, max: 39, label: 'GitHub username' });
  const requestedRole = getString(body, 'role', { max: 10 }) === 'owner' ? 'owner' : 'admin';
  if (requestedRole === 'owner' && role !== 'owner') {
    return json({ error: 'Only the list owner can transfer ownership.' }, 403);
  }
  const result = await addGroupAdmin(env.DB, group.id, user, login, requestedRole);
  return json({ admins: await listAdmins(env.DB, group.id), pending: result.pending }, 201);
});

export const DELETE = api(async ({ locals, params, request }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group } = await requireMembership(env.DB, params.id!, user, 'admin');
  const body = await readJson(request);
  const login = getString(body, 'login', { required: true, max: 39, label: 'GitHub username' });
  await removeInvite(env.DB, group.id, login);
  return json({ admins: await listAdmins(env.DB, group.id) });
});
