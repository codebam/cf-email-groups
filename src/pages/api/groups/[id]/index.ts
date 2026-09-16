import { getEnv } from '../../../../lib/config';
import {
  countsByStatus,
  deleteGroup,
  groupRowToDetail,
  requireMembership,
  updateGroup,
} from '../../../../lib/groups';
import { api, getBool, getString, json, readJson, requireUser } from '../../../../lib/http';

export const GET = api(async ({ locals, params }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group, role } = await requireMembership(env.DB, params.id!, user, 'admin');
  const counts = await countsByStatus(env.DB, group.id);
  return json({ group: groupRowToDetail(group, role, counts) });
});

export const PATCH = api(async ({ locals, params, request }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group } = await requireMembership(env.DB, params.id!, user, 'admin');
  const body = await readJson(request);
  const updated = await updateGroup(env.DB, group, {
    name: body.name !== undefined ? getString(body, 'name', { required: true, min: 2, max: 120, label: 'List name' }) : undefined,
    description: body.description !== undefined ? getString(body, 'description', { max: 2000, label: 'Description' }) : undefined,
    fromName: body.fromName !== undefined ? getString(body, 'fromName', { max: 120, label: 'From name' }) : undefined,
    fromEmail: body.fromEmail !== undefined ? getString(body, 'fromEmail', { max: 254, label: 'From email' }) : undefined,
    replyTo: body.replyTo !== undefined ? getString(body, 'replyTo', { max: 254, label: 'Reply-to' }) : undefined,
    doubleOptIn: body.doubleOptIn !== undefined ? getBool(body, 'doubleOptIn', true) : undefined,
    publicSignup: body.publicSignup !== undefined ? getBool(body, 'publicSignup', true) : undefined,
  });
  const role = (await requireMembership(env.DB, updated.id, user, 'admin')).role;
  const counts = await countsByStatus(env.DB, updated.id);
  return json({ group: groupRowToDetail(updated, role, counts) });
});

export const DELETE = api(async ({ locals, params, request }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group, role } = await requireMembership(env.DB, params.id!, user, 'admin');
  if (role !== 'owner') {
    return json({ error: 'Only the list owner can delete this list.' }, 403);
  }
  const body = await readJson(request);
  const confirmSlug = getString(body, 'confirmSlug', { max: 63 });
  if (confirmSlug !== group.slug) {
    return json({ error: 'Type the list slug to confirm deletion.' }, 400);
  }
  await deleteGroup(env.DB, group.id);
  return json({ ok: true });
});
