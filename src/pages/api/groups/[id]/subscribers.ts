import { appOrigin, getEnv } from '../../../../lib/config';
import { requireMembership } from '../../../../lib/groups';
import { api, getBool, getString, json, pagination, readJson, requireUser } from '../../../../lib/http';
import { addSubscriber, listSubscribers, rowToSubscriber } from '../../../../lib/subscribers';
import type { SubscriberStatus } from '../../../../lib/types';

const STATUSES: SubscriberStatus[] = ['pending', 'active', 'unsubscribed', 'bounced', 'complained'];

export const GET = api(async ({ locals, params, url }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group } = await requireMembership(env.DB, params.id!, user, 'admin');
  const rawStatus = url.searchParams.get('status') ?? 'all';
  const status = STATUSES.includes(rawStatus as SubscriberStatus) ? (rawStatus as SubscriberStatus) : 'all';
  const { page, pageSize } = pagination(url, { pageSize: 50, maxPageSize: 200 });
  const result = await listSubscribers(env.DB, group.id, {
    status,
    query: (url.searchParams.get('q') ?? '').trim(),
    page,
    pageSize,
  });
  return json(result);
});

export const POST = api(async ({ locals, params, request }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group } = await requireMembership(env.DB, params.id!, user, 'admin');
  const body = await readJson(request);
  const email = getString(body, 'email', { required: true, max: 254, label: 'Email' });
  const name = getString(body, 'name', { max: 120, label: 'Name' });
  const status = getString(body, 'status', { max: 10 }) === 'pending' ? 'pending' : 'active';
  const sendWelcome = getBool(body, 'sendWelcome', false);
  const result = await addSubscriber(
    env,
    env.DB,
    group,
    { email, name, status, source: 'admin', sendWelcome },
    appOrigin(request, env),
  );
  return json(
    {
      subscriber: rowToSubscriber(result.subscriber),
      existed: result.existed,
      warning: result.emailResult?.error,
    },
    201,
  );
});
