import { getEnv } from '../../../../lib/config';
import { createCampaign, listCampaigns, rowToCampaign } from '../../../../lib/campaigns';
import { requireMembership } from '../../../../lib/groups';
import { api, getString, json, readJson, requireUser } from '../../../../lib/http';

export const GET = api(async ({ locals, params }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group } = await requireMembership(env.DB, params.id!, user, 'admin');
  return json({ campaigns: await listCampaigns(env.DB, group.id) });
});

export const POST = api(async ({ locals, params, request }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { group } = await requireMembership(env.DB, params.id!, user, 'admin');
  const body = await readJson(request);
  const campaign = await createCampaign(env.DB, group, user, {
    subject: getString(body, 'subject', { max: 200, label: 'Subject' }),
    bodyMd: getString(body, 'bodyMd', { max: 200_000, label: 'Email body' }),
  });
  return json({ campaign: rowToCampaign(campaign) }, 201);
});
