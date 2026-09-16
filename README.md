# CF-Email-Groups

A dedicated email sign-up page and mailing-list admin for **lists.seanbehan.ca**, running as one Cloudflare Worker.

- **Single-list mode is on by default**: the deployment serves exactly one mailing list, `Sean Behan`
  (`/join/seanbehan`). The root of the domain is the public sign-up page; management lives at
  `https://lists.seanbehan.ca/app`.
- **Only GitHub user `@codebam` can sign in** (`ALLOWED_GITHUB_LOGINS=codebam`). That account becomes the list owner.
- **Astro + Preact islands** frontend, **Cloudflare D1** database, **GitHub OAuth**, no passwords.
- **Double opt-in** sign-ups with honeypot + optional Turnstile, CSV import/export, admin invites, Markdown campaigns
  with test sends, batched delivery, and per-recipient tracking.
- **RFC 8058 one-click unsubscribe** plus a friendly unsubscribe page.
- **Pluggable email**: Cloudflare Email Service (`send_email` binding) or Resend.

> Forking this for a different group? Set `SINGLE_LIST=0` to get the full multi-list dashboard. Everything below
> explains both modes.

---

## Is this possible on Cloudflare Workers?

Yes. Everything runs in a Worker; the only external dependency is outbound email delivery to arbitrary addresses:

| Option | Notes |
| --- | --- |
| **Cloudflare Email Service** (the default binding is configured) | `send_email` binding. Arbitrary recipients require the Workers Paid plan (3,000 emails/month included, then $0.35/1,000), an onboarded sending domain, and new accounts start with a lower daily quota. Cloudflare currently says it's **for transactional email only** — bulk/marketing tooling is "planned". |
| **Resend** (recommended for newsletters) | Simple HTTP API, batch endpoint. Set `RESEND_API_KEY` and this app prefers it automatically. |
| **log** | Dev-only provider that records mail in D1 (`email_outbox`) without sending anything. |

Other providers with HTTP APIs (Postmark, Loops, SendGrid, Mailgun, Brevo, AWS SES…) can be added with ~30 lines in
[`src/lib/email.ts`](src/lib/email.ts).

---

## Quick start (local)

```bash
pnpm install
cp .dev.vars.example .dev.vars      # local secrets/overrides
pnpm db:migrate:local               # create the local D1 schema
pnpm dev                            # http://localhost:4321
```

Locally, `http://localhost:4321/` is the public sign-up page and
`http://localhost:4321/app` is the admin (the dashboard skips straight to the single list). Click **Sign in** and use
the **local development sign-in** box (enabled by `DEV_AUTH=1`) — the dev shortcut bypasses the GitHub allow-list so you
can try any username. Email is simulated; inspect links at:

```
GET /api/dev/outbox?to=someone@example.com&kind=confirm
```

### Tests

```bash
pnpm test     # 24 unit tests (markdown/CSV/tokens/templates/single-list config)
pnpm smoke    # full E2E against a running dev server
```

With the dev server running, `pnpm smoke` signs in, subscribes via the public API, reads the confirmation link from the
dev outbox, confirms, exercises campaign creation (real send on an empty/smoke list, test-send only if your list already
has subscribers), one-click unsubscribes, exports CSV, and cleans up after itself.

---

## Single-list mode

Enabled by `SINGLE_LIST=1` in `wrangler.jsonc`. Behaviour:

- `GET /` is the public sign-up page (or a "sign-ups closed" card).
- `GET /app` redirects to the one list's admin page.
- `POST /api/groups` is disabled (HTTP 400); other list slugs redirect to the configured one.
- The list is auto-created from `SINGLE_LIST_*` on first request — no setup step needed.
- The **first allow-listed GitHub account to sign in becomes owner**; any other allow-listed account joins as an admin.
- `ENFORCE_CANONICAL_HOST=1` redirects production HTML requests on other hosts (workers.dev, preview URLs) to
  `APP_URL`, so management only happens at `lists.seanbehan.ca`.

Configuration (`wrangler.jsonc` → `vars`):

| Var | Value here | Meaning |
| --- | --- | --- |
| `SINGLE_LIST` | `1` | Enable single-list mode |
| `SINGLE_LIST_SLUG` | `seanbehan` | `lists.seanbehan.ca/join/seanbehan` |
| `SINGLE_LIST_NAME` | `Sean Behan` | List / sender display name |
| `SINGLE_LIST_DESCRIPTION` | `Occasional updates…` | Shown on the sign-up page |
| `ALLOWED_GITHUB_LOGINS` | `codebam` | Only this account can sign in; first entry becomes owner |
| `APP_URL` | `https://lists.seanbehan.ca` | Canonical origin used in emails and redirects |
| `ENFORCE_CANONICAL_HOST` | `1` | Redirect other production hosts to `APP_URL` |

To develop multi-list behaviour locally, set `SINGLE_LIST=0` in `.dev.vars`. To deploy as a multi-list app, set
`SINGLE_LIST: "0"` in `wrangler.jsonc` (and remove the canonical-host vars if you don't want the redirect).

---

## Deploy to lists.seanbehan.ca

Prerequisites:

1. The `seanbehan.ca` zone is in your Cloudflare account (custom domains configure DNS automatically).
2. Workers Paid is recommended so Cloudflare Email Service can send to arbitrary recipients (or use Resend).
3. A GitHub OAuth App with callback URL `https://lists.seanbehan.ca/api/auth/github/callback`.

Steps:

```bash
# 1. Production database
pnpm wrangler d1 create cf-email-groups          # paste database_id into wrangler.jsonc
pnpm db:migrate:remote

# 2. GitHub OAuth secrets (callback URL above)
pnpm wrangler secret put GITHUB_CLIENT_ID
pnpm wrangler secret put GITHUB_CLIENT_SECRET

# 3. Email (pick one; details in the next section)
pnpm wrangler secret put RESEND_API_KEY           # if using Resend
pnpm wrangler secret put RESEND_WEBHOOK_SECRET    # if using Resend webhooks

# 4. Build + deploy; wrangler creates the lists.seanbehan.ca custom domain + DNS
pnpm deploy
```

Then visit `https://lists.seanbehan.ca/login`, sign in as `@codebam`, and you'll own the list automatically. The public
sign-up page is at `https://lists.seanbehan.ca/`.

`wrangler.jsonc` currently disables the workers.dev URL (`"workers_dev": false`, `"preview_urls": false`). For
first-time testing without DNS, temporarily remove the `routes` block and set `"workers_dev": true`.

OAuth note: a GitHub OAuth App supports one callback URL. Use a second app (or temporarily change the callback) if you
want GitHub sign-in on a workers.dev preview as well as the custom domain.

---

## Configure email delivery

The provider is chosen at send time:

1. `RESEND_API_KEY` → Resend
2. otherwise the `send_email` binding named `EMAIL` → Cloudflare Email Service
3. otherwise `EMAIL_PROVIDER=log` → journal only (safe for dev, refuses to pretend in production)

Force a provider with `EMAIL_PROVIDER=cloudflare|resend|log`.

### Cloudflare Email Service

`wrangler.jsonc` already contains:

```jsonc
"send_email": [{ "name": "EMAIL" }]
```

- Locally, wrangler **simulates** sends and logs them; the app also journals every rendered email in D1.
- In production, onboard a sending domain (`seanbehan.ca`, or the `lists.seanbehan.ca` subdomain) in the Cloudflare
  dashboard. `EMAIL_FROM=Sean Behan <lists@seanbehan.ca>` is already set in `wrangler.jsonc`.
- To send real mail from local dev, add `"remote": true` to the binding — **it will send to real recipients**.
- Arbitrary recipients need Workers Paid. Cloudflare currently treats this as transactional email; see the note below.

### Resend (recommended for newsletters)

```bash
pnpm wrangler secret put RESEND_API_KEY          # re_...
pnpm wrangler secret put RESEND_WEBHOOK_SECRET   # optional but recommended
```

Verify `seanbehan.ca` (or `lists.seanbehan.ca`) in Resend, set the sender to an address on it, then add a webhook to
`https://lists.seanbehan.ca/api/webhooks/resend` for `email.bounced`, `email.complained`, and `email.delivered`. The
endpoint verifies the Svix signature and marks subscribers `bounced`/`complained`, excluding them from future sends.

> Cloudflare's FAQ says Email Service is currently **intended for transactional email only** and that bulk/marketing
> tooling is planned. For a newsletter, use Resend (or another bulk-friendly provider) and leave `RESEND_API_KEY` set.

### Environment variables

| Name | Where | Purpose |
| --- | --- | --- |
| `ENVIRONMENT` | wrangler var / `.dev.vars` | `development` enables dev-only routes; `production` disables them |
| `APP_URL` | var | Canonical origin used in email links and redirects |
| `ENFORCE_CANONICAL_HOST` | var | Redirect production HTML traffic to `APP_URL`'s host |
| `SINGLE_LIST` / `SINGLE_LIST_SLUG` / `SINGLE_LIST_NAME` / `SINGLE_LIST_DESCRIPTION` | var | Dedicated-list configuration |
| `ALLOWED_GITHUB_LOGINS` | var | Comma-separated sign-in allow-list; first entry is the preferred owner |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | secret | GitHub OAuth app |
| `EMAIL_PROVIDER` | var | `cloudflare` \| `resend` \| `log` (auto-detected when empty) |
| `EMAIL_FROM` | var | Sender, `Name <address@domain>` |
| `RESEND_API_KEY` | secret | Resend API key |
| `RESEND_WEBHOOK_SECRET` | secret | Resend/Svix webhook signing secret (`whsec_...`) |
| `TURNSTILE_SECRET` / `PUBLIC_TURNSTILE_SITE_KEY` | secret / var | Enable Turnstile on the public sign-up form (both required) |
| `DEV_AUTH` | `.dev.vars` only | `1` enables `/api/auth/dev` (never set in production) |

Secrets are set with `pnpm wrangler secret put <NAME>`; nothing sensitive belongs in `wrangler.jsonc` or git.

---

## How it works

```
src/
  lib/            server + pure logic
    single.ts     single-list/allow-list config (unit-tested)
    auth: github.ts, sessions.ts, users.ts
    data: db.ts, groups.ts, subscribers.ts, campaigns.ts
    mail: email.ts (providers + outbox), templates.ts
    util: ids.ts, markdown.ts, csv.ts, http.ts, config.ts
  middleware.ts   session lookup, allow-list, single-list bootstrap, canonical host, security headers
  pages/          Astro SSR pages + JSON API routes under /api
  components/     Preact islands (GroupApp, tabs, SignupForm, JoinPanel, UserMenu)
migrations/       D1 schema (wrangler d1 migrations)
scripts/smoke.sh  end-to-end local check
tests/            Vitest unit tests
wrangler.jsonc    custom domain, D1, email binding, single-list vars
```

**Roles.** `@codebam` owns the list. Additional allow-listed GitHub accounts join as admins automatically, and you can
also invite admins by username from Settings (they must be allow-listed to sign in). Only the owner can rename,
transfer, or delete the list — and in single-list mode the delete action is hidden, since the list is defined by config.

**Subscriber lifecycle.** `pending → active → unsubscribed` (plus `bounced` / `complained` from provider webhooks).
Public sign-ups are double opt-in by default; admins and CSV imports can mark addresses active directly.

**Campaign sending.** The UI calls `POST /api/campaigns/:id/send` repeatedly. Each call claims a batch of up to 100
subscribers, renders a personalised email, records a `campaign_sends` row, and compare-and-swaps a cursor so two
concurrent senders can't double-send. For very large lists, move the same batch function behind Cloudflare Queues.

---

## API sketch

| Route | Purpose |
| --- | --- |
| `GET /api/me` | Current user + their lists |
| `POST /api/groups` | Create a list (**disabled in single-list mode**) |
| `GET/PATCH/DELETE /api/groups/:id` | Settings / delete (owner) |
| `GET/POST /api/groups/:id/subscribers` | List / add subscribers |
| `PATCH/DELETE /api/groups/:id/subscribers/:sid` | Update / remove a subscriber |
| `POST /api/groups/:id/import`, `GET …/export` | CSV import/export |
| `GET/POST/DELETE /api/groups/:id/admins` | Admin invitations |
| `GET/POST /api/groups/:id/campaigns` | List / create campaigns |
| `POST /api/campaigns/:id/send` | Send the next batch (returns progress) |
| `POST /api/campaigns/:id/test` | Send a preview to yourself |
| `POST /api/public/subscribe` | Public sign-up (honeypot, rate limit, Turnstile) |
| `POST /api/public/unsubscribe?token=…` | RFC 8058 one-click unsubscribe |
| `POST /api/webhooks/resend` | Bounce/complaint suppression |
| `GET /api/health` | Health check |

All state-changing API routes require a session and check list membership; mutations also get a same-origin check
(SameSite=Lax cookies plus an `Origin` header check in `src/middleware.ts`).

---

## Security notes

- Sign-in is restricted to `ALLOWED_GITHUB_LOGINS`; sessions for accounts removed from the list stop working on their
  next request.
- GitHub access tokens are used only for the profile fetch and never stored.
- Session tokens are 32 random bytes; only their SHA-256 hash is stored in D1. Cookies are `HttpOnly`,
  `SameSite=Lax`, and `Secure` on HTTPS.
- Public sign-ups are rate-limited per IP and per address; optional Turnstile and a honeypot are built in.
- Campaign Markdown is escaped/sanitized before rendering; link URLs are scheme-checked.
- Email headers are stripped of CR/LF to prevent header injection.
- Resend webhooks are verified with the Svix signature scheme and a 5-minute timestamp window.
- Production HTML traffic is redirected to `APP_URL`, so the admin UI isn't reachable on workers.dev.

---

## Known limitations / next steps

- Campaign delivery is driven by the browser calling batches. It survives closing the tab only if you re-open it; for
  unattended delivery, bind the send function to Cloudflare Queues or a Workflow.
- No scheduling, A/B tests, open/click tracking, or attachments yet.
- `email_outbox` keeps a copy of transactional emails; campaign bodies are deliberately not stored per recipient.
  Prune it if you send at scale.
- Cloudflare Email Service is in beta and transactional-only; use Resend for larger newsletters.

MIT licensed — see [LICENSE](LICENSE).
