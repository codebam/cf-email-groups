import { getEnv } from '../../../../lib/config';
import { getGroupBySlug } from '../../../../lib/groups';
import { singleListConfig } from '../../../../lib/single';
import { api, json } from '../../../../lib/http';

export const GET = api(async ({ params }) => {
  const env = getEnv();
  const single = singleListConfig(env);
  const group = await getGroupBySlug(env.DB, params.slug!);
  if (single && (!group || group.slug !== single.slug)) {
    return json({ error: 'This list was not found or is not accepting sign-ups.' }, 404);
  }
  if (!group || group.public_signup !== 1) {
    return json({ error: 'This list was not found or is not accepting sign-ups.' }, 404);
  }
  return json({
    group: {
      name: group.name,
      slug: group.slug,
      description: group.description,
      doubleOptIn: group.double_opt_in === 1,
      requiresTurnstile: Boolean(env.TURNSTILE_SECRET && env.PUBLIC_TURNSTILE_SITE_KEY),
      turnstileSiteKey: env.PUBLIC_TURNSTILE_SITE_KEY ?? null,
    },
  });
});
