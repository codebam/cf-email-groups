import { getEnv } from '../../../../lib/config';
import { getCampaign, requireCampaignAccess, sendTestCampaign } from '../../../../lib/campaigns';
import { isValidEmail } from '../../../../lib/csv';
import { api, getString, json, rateLimit, readJson, requireUser } from '../../../../lib/http';

export const POST = api(async ({ locals, params, request }) => {
  const user = requireUser(locals);
  const env = getEnv();
  const { campaign, group } = await requireCampaignAccess(env.DB, params.id!, user, 'admin');
  const body = await readJson(request);

  if (!(await rateLimit(env.DB, `test:${user.id}`, 10, 3600))) {
    return json({ error: 'Too many test sends. Try again later.' }, 429);
  }

  const to = (body.to ? getString(body, 'to', { max: 254, label: 'Email' }) : user.email ?? '').toLowerCase();
  if (!to || !isValidEmail(to)) return json({ error: 'Add a valid email address to send the test to.' }, 400);

  const subject = body.subject !== undefined ? getString(body, 'subject', { max: 200, label: 'Subject' }) : campaign.subject;
  const bodyMd = body.bodyMd !== undefined ? getString(body, 'bodyMd', { max: 200_000, label: 'Email body' }) : campaign.body_md;
  const fresh = (await getCampaign(env.DB, campaign.id)) ?? campaign;
  const result = await sendTestCampaign(env, env.DB, group, { subject: subject || fresh.subject, bodyMd }, to);
  if (!result.ok) return json({ error: result.error ?? 'Test send failed.' }, 502);
  return json({ ok: true, to });
});
