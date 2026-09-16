import { getEnv } from '../../../lib/config';
import { deleteCampaign, requireCampaignAccess, rowToCampaign, updateCampaign } from '../../../lib/campaigns';
import { api, getString, json, readJson, requireUser } from '../../../lib/http';

export const GET = api(async ({ locals, params }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { campaign } = await requireCampaignAccess(env.DB, params.id!, user, 'admin');
  return json({ campaign: rowToCampaign(campaign) });
});

export const PATCH = api(async ({ locals, params, request }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { campaign } = await requireCampaignAccess(env.DB, params.id!, user, 'admin');
  const body = await readJson(request);
  const updated = await updateCampaign(env.DB, campaign, {
    subject: body.subject !== undefined ? getString(body, 'subject', { max: 200, label: 'Subject' }) : campaign.subject,
    bodyMd: body.bodyMd !== undefined ? getString(body, 'bodyMd', { max: 200_000, label: 'Email body' }) : campaign.body_md,
  });
  return json({ campaign: rowToCampaign(updated) });
});

export const DELETE = api(async ({ locals, params }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { campaign } = await requireCampaignAccess(env.DB, params.id!, user, 'admin');
  await deleteCampaign(env.DB, campaign);
  return json({ ok: true });
});
