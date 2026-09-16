import { getEnv } from '../../lib/config';
import { assertSchemaApplied } from '../../lib/db';
import { api, json } from '../../lib/http';

export const GET = api(async () => {
  const env = getEnv();
  let db: 'ok' | 'unmigrated' = 'ok';
  try {
    await assertSchemaApplied(env.DB);
  } catch {
    db = 'unmigrated';
  }
  return json({ ok: db === 'ok', service: 'cf-email-groups', db, time: new Date().toISOString() });
});
