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
pnpm test     # unit tests: public sign-up origin/form/JSON behaviour, markdown, CSV, tokens, templates, single-list
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

## Direct no-JS sign-up forms (host sites)

Pages on an allow-listed origin can post a plain HTML form straight to
`POST /api/public/subscribe` — no JavaScript, no iframe, and no server-side
proxy. The allow-list is the non-secret `ALLOWED_SIGNUP_ORIGINS` var: a
comma-separated list of exact `scheme://host[:port]` origins. This deployment
sets:

```jsonc
"ALLOWED_SIGNUP_ORIGINS": "https://seanbehan.ca,https://codebam.ca"
```

Example form for a host page on `https://seanbehan.ca` (the page can be static
HTML; the hidden fields are the entire integration):

```html
<form method="post" action="https://lists.seanbehan.ca/api/public/subscribe">
  <input type="hidden" name="slug" value="seanbehan" />
  <input type="email" name="email" required />
  <input type="text" name="name" />
  <!-- `next` must be a same-origin path, or an absolute http(s) URL whose
       origin is this host or on ALLOWED_SIGNUP_ORIGINS. -->
  <input type="hidden" name="next" value="https://seanbehan.ca/test-page" />
  <!-- Honeypot: off-screen to humans, tempting to bots. -->
  <div style="position:absolute;left:-9999px" aria-hidden="true">
    <label>Website
      <input type="text" name="website" tabindex="-1" autocomplete="off" />
    </label>
  </div>
  <button type="submit">Subscribe</button>
</form>
```

The browser follows the `303 See Other` immediately, so the visitor lands back
on `next` (or `/join/<slug>`) with a result query param to render:

| Redirect param | Meaning |
| --- | --- |
| `subscribed=confirm` | Subscriber is pending; a double opt-in confirmation email was sent (honeypot submissions get this shape too, without creating a subscriber) |
| `subscribed=done` | Subscriber is active (double opt-in disabled, or address was already active) |
| `subscribe_error=invalid` | Missing/invalid field or email; a malformed form body |
| `subscribe_error=rate` | IP rate limit hit (`15 / 10 min`); per-address throttle instead fakes success |
| `subscribe_error=unavailable` | List missing/closed, or an unexpected backend failure |
| `subscribe_error=turnstile` | Turnstile is enabled and the form's token is missing/failed (see below) |

The redirect URL keeps `next`'s existing query string and replaces stale
`subscribed` / `subscribe_error` params. A missing or unsafe `next` falls back
to `/join/<slug>` on the service origin.

**`next` rules (open-redirect guard).** Accepted targets are only:

- absolute same-origin paths (`/test-page?campaign=1#top`);
- absolute `http(s)` URLs whose normalized origin is either the service origin
  or an `ALLOWED_SIGNUP_ORIGINS` entry, with no userinfo.

Protocol-relative URLs (`//host`), backslashes, control characters, credentials
in the authority, and non-`http(s)` schemes are ignored. An invalid `next`
never produces a 3xx to the attacker's URL; the response goes to `/join/<slug>`.

**Content types and fields.** `application/x-www-form-urlencoded` and
`multipart/form-data` are parsed alongside `application/json`; the same field
validation, group lookup, honeypot, IP/address rate limits, and double opt-in
path run for all three. The fields are `slug`, `email`, `name`, `website`
(honeypot), `turnstileToken` (or the Turnstile widget's implicit
`cf-turnstile-response`), and `next`.

**JSON/CORS compatibility.** Requests with no `Origin` still work exactly as
before (the current host-site proxy sends JSON with no `Origin`). Same-origin
JSON and JSON from an allow-listed origin return the original JSON body:
`{ ok, requiresConfirmation, existed, warning? }` on success, or
`{ error: "..." }` on failure. Allow-listed JSON callers additionally get
`Access-Control-Allow-Origin: <exact origin>` + `Vary: Origin` (never `*`, no
credentials); `OPTIONS` preflight answers `POST, OPTIONS` + `Content-Type`.
The no-JS form flow needs none of that — form navigation is not subject to
CORS. JSON callers always get the JSON response; `next` only affects form
posts.

**Turnstile.** A list requires Turnstile only when both `TURNSTILE_SECRET` and
`PUBLIC_TURNSTILE_SITE_KEY` are configured (the `seanbehan` list is
`requiresTurnstile=false` today). The public site key is the deployment's
`PUBLIC_TURNSTILE_SITE_KEY` (also exposed by `GET /api/public/groups/<slug>`
for server-side host tooling). JSON/JS clients send `turnstileToken`. A form can
pass a token only if the host page renders the Turnstile widget with that site
key; the widget injects a hidden `cf-turnstile-response` field and requires
client-side JavaScript. So a literal JavaScript-off form cannot pass a
Turnstile-protected list. Missing/failed tokens redirect with
`subscribe_error=turnstile` (JSON callers get the usual
`400 {"error":"Verification failed..."}`).

Host-site constraints:

- Use the absolute action URL `https://lists.seanbehan.ca/api/public/subscribe`.
- `slug` must be the public list slug and the list must have sign-ups enabled.
- The `next` page must be on the host's own allow-listed origin (or a
  same-origin path on the list service); third-party return URLs are ignored.
- Add the exact host origin (`https://codebam.ca`, `https://www.seanbehan.ca`,
  a local dev origin, …) to `ALLOWED_SIGNUP_ORIGINS` and redeploy before
  pointing a form there. Wildcards, subdomain inference, and credentials are
  intentionally unsupported.
- Keep the honeypot field submittable but off-screen; don't switch it to
  `type="hidden"` (`website` must remain a text field that bots will fill).
- No cookies/credentials are sent or accepted on the cross-origin route; the
  endpoint is unauthenticated by design, as before.

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

### Deploying the direct sign-up allow-list

`ALLOWED_SIGNUP_ORIGINS` is a plain non-secret `vars` entry. This deployment ships
`https://seanbehan.ca,https://codebam.ca` (see [Direct no-JS sign-up forms](#direct-no-js-sign-up-forms-host-sites)).
To change it, edit that line in `wrangler.jsonc`, run `pnpm deploy`, and the new origin is live. No D1 migration or
secret rotation is involved.

The existing host-site same-origin proxy is unaffected because no-`Origin` JSON still returns the original JSON
responses. Leave that proxy running until the direct form works in production, then remove it; no Worker change is
needed when the proxy goes away.

---

## Troubleshooting

### The site returns a blank 500 right after deploy

The Worker is fine; the **remote D1 database has no schema**. The Worker's first query (`SELECT ... FROM groups`)
throws `D1_ERROR: no such table: groups`, which is exactly a bare 500 with an empty body. Apply the migrations to the
remote database:

```bash
# Check whether the migration is recorded remotely:
pnpm exec wrangler d1 migrations list DB --remote

# Apply it:
pnpm db:migrate:remote
# or: pnpm exec wrangler d1 migrations apply DB --remote

# Confirm the tables exist:
pnpm exec wrangler d1 execute DB --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

No redeploy is needed — D1 lives outside the Worker. Reload `https://lists.seanbehan.ca/` afterwards.

If it still fails:

- `pnpm exec wrangler d1 list` — confirm the `database_id` in `wrangler.jsonc` matches the database you migrated.
- `pnpm exec wrangler tail cf-email-groups --format pretty` in one terminal while loading the site in another; the live
  exception is printed there.
- `https://lists.seanbehan.ca/api/health` now reports `"db": "ok" | "unmigrated"`, and the app returns a plain-text 503
  with the migration command instead of a blank 500 (redeploy to get this newer behaviour).

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
| `ALLOWED_SIGNUP_ORIGINS` | var | Comma-separated exact origins allowed to post directly to `/api/public/subscribe` (no-JS forms + CORS); no wildcards |
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
    public signup: public-signup.ts (shared JSON/form flow), signup-origins.ts (origin allow-list + next safety)
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
| `OPTIONS /api/public/subscribe` | CORS preflight for allow-listed JSON callers (no wildcard, no credentials) |
| `POST /api/public/unsubscribe?token=…` | RFC 8058 one-click unsubscribe |
| `POST /api/webhooks/resend` | Bounce/complaint suppression |
| `GET /api/health` | Health check |

All state-changing API routes require a session and check list membership; mutations also get a same-origin check
(SameSite=Lax cookies plus an `Origin` header check in `src/middleware.ts`). The public sign-up route is the one
exception: it still rejects unknown browser origins, but origins in `ALLOWED_SIGNUP_ORIGINS` may post directly (with
form redirects and an exact-origin CORS policy) while no-`Origin` server-to-server JSON continues to work.

---

## Security notes

- Sign-in is restricted to `ALLOWED_GITHUB_LOGINS`; sessions for accounts removed from the list stop working on their
  next request.
- GitHub access tokens are used only for the profile fetch and never stored.
- Session tokens are 32 random bytes; only their SHA-256 hash is stored in D1. Cookies are `HttpOnly`,
  `SameSite=Lax`, and `Secure` on HTTPS.
- Public sign-ups are rate-limited per IP and per address; optional Turnstile and a honeypot are built in.
- Direct cross-origin sign-up posts are restricted to exact `ALLOWED_SIGNUP_ORIGINS`; CORS never uses `*` or credentials, and `next` is validated against same-origin paths plus allow-listed origins (no open redirect).
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
