import { appOrigin, getEnv } from '../../../../lib/config';
import { requireCampaignAccess, sendCampaignBatch } from '../../../../lib/campaigns';
import { api, getBool, getInt, json, readJson, requireUser } from '../../../../lib/http';

export const POST = api(async ({ locals, params, request }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { campaign, group } = await requireCampaignAccess(env.DB, params.id!, user, 'admin');
  const body = await readJson(request);
  const progress = await sendCampaignBatch(env, env.DB, group, campaign, {
    batchSize: getInt(body, 'batchSize', 25, 1, 100),
    retryFailed: getBool(body, 'retryFailed', false),
    appUrl: appOrigin(request, env),
  });
  return json(progress);
});
