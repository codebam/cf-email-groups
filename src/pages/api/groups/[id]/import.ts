import { appOrigin, getEnv } from '../../../../lib/config';
import { parseCsv, extractSubscriberRows } from '../../../../lib/csv';
import { requireMembership } from '../../../../lib/groups';
import { api, getBool, getString, json, readJson, requireUser } from '../../../../lib/http';
import { importSubscribers } from '../../../../lib/subscribers';

export const POST = api(async ({ locals, params, request }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group } = await requireMembership(env.DB, params.id!, user, 'admin');
  const body = await readJson(request, 3_000_000);
  const csv = getString(body, 'csv', { required: true, max: 2_000_000, label: 'CSV data' });
  const status = getString(body, 'status', { max: 10 }) === 'active' ? 'active' : 'pending';
  const sendConfirmations = getBool(body, 'sendConfirmations', status === 'pending');
  const parsed = extractSubscriberRows(parseCsv(csv));
  const result = await importSubscribers(
    env,
    env.DB,
    group,
    parsed.rows,
    { status, sendConfirmations },
    appOrigin(request, env),
  );
  return json({ ...result, invalid: result.invalid + parsed.invalid });
});
