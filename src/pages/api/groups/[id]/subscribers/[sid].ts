import { appOrigin, getEnv } from '../../../../../lib/config';
import { requireMembership } from '../../../../../lib/groups';
import { api, getBool, getString, json, readJson, requireUser } from '../../../../../lib/http';
import { getSubscriber, removeSubscriber, rowToSubscriber, updateSubscriber } from '../../../../../lib/subscribers';
import type { SubscriberStatus } from '../../../../../lib/types';

const STATUSES: SubscriberStatus[] = ['pending', 'active', 'unsubscribed', 'bounced', 'complained'];

export const PATCH = api(async ({ locals, params, request }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group } = await requireMembership(env.DB, params.id!, user, 'admin');
  const subscriber = await getSubscriber(env.DB, group.id, params.sid!);
  if (!subscriber) return json({ error: 'Subscriber not found.' }, 404);
  const body = await readJson(request);
  const rawStatus = body.status !== undefined ? getString(body, 'status', { max: 12 }) : undefined;
  if (rawStatus && !STATUSES.includes(rawStatus as SubscriberStatus)) {
    return json({ error: 'Unknown subscriber status.' }, 400);
  }
  const result = await updateSubscriber(
    env,
    env.DB,
    group,
    subscriber,
    {
      name: body.name !== undefined ? getString(body, 'name', { max: 120, label: 'Name' }) : undefined,
      email: body.email !== undefined ? getString(body, 'email', { required: true, max: 254, label: 'Email' }) : undefined,
      status: rawStatus as SubscriberStatus | undefined,
      resendConfirmation: getBool(body, 'resendConfirmation', false),
    },
    appOrigin(request, env),
  );
  return json({
    subscriber: rowToSubscriber(result.subscriber),
    warning: result.emailResult?.error,
  });
});

export const DELETE = api(async ({ locals, params }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group } = await requireMembership(env.DB, params.id!, user, 'admin');
  await removeSubscriber(env.DB, group.id, params.sid!);
  return json({ ok: true });
});
