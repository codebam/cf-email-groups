import { getEnv } from '../../../../lib/config';
import { requireMembership } from '../../../../lib/groups';
import { api, requireUser } from '../../../../lib/http';
import { exportSubscribersCsv } from '../../../../lib/subscribers';

export const GET = api(async ({ locals, params }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group } = await requireMembership(env.DB, params.id!, user, 'admin');
  const csv = await exportSubscribersCsv(env.DB, group.id);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${group.slug}-subscribers-${date}.csv"`,
      'cache-control': 'no-store',
    },
  });
});
