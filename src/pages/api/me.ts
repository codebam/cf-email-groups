import { getEnv } from '../../lib/config';
import { listGroupsForUser } from '../../lib/groups';
import { api, json, requireUser } from '../../lib/http';

export const GET = api(async ({ locals }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const groups = await listGroupsForUser(env.DB, user.id);
  return json({ user, groups });
});
