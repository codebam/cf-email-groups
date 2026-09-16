import { getEnv } from '../../../../../lib/config';
import { listAdmins, removeGroupAdmin, requireMembership } from '../../../../../lib/groups';
import { api, json, requireUser } from '../../../../../lib/http';

export const DELETE = api(async ({ locals, params }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group } = await requireMembership(env.DB, params.id!, user, 'admin');
  await removeGroupAdmin(env.DB, group.id, params.userId!);
  return json({ admins: await listAdmins(env.DB, group.id) });
});
