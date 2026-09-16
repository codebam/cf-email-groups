import { api, json } from '../../lib/http';

export const GET = api(async () =>
  json({ ok: true, service: 'cf-email-groups', time: new Date().toISOString() }),
);
