import { getEnv } from '../../../lib/config';
import { singleListConfig } from '../../../lib/single';
import { createGroup, listGroupsForUser } from '../../../lib/groups';
import { api, getString, HttpError, json, readJson, requireUser } from '../../../lib/http';

export const GET = api(async ({ locals }) => {
  const user = requireUser(locals);
  const env = getEnv();
  return json({ groups: await listGroupsForUser(env.DB, user.id) });
});

export const POST = api(async ({ locals, request }) => {
  const user = requireUser(locals);
  const env = getEnv();
  if (singleListConfig(env)) {
    throw new HttpError(400, 'This deployment is dedicated to a single mailing list, so new lists cannot be created.');
  }
  const body = await readJson(request);
  const name = getString(body, 'name', { required: true, min: 2, max: 120, label: 'List name' });
  const description = getString(body, 'description', { max: 2000, label: 'Description' });
  const slug = getString(body, 'slug', { max: 63, label: 'URL slug' });
  const group = await createGroup(env.DB, user, { name, description, slug: slug || undefined });
  return json({ group: { id: group.id, slug: group.slug, name: group.name } }, 201);
});
