-- CF-Email-Groups initial schema
-- Conventions: TEXT ids are crypto.randomUUID(), timestamps are ISO-8601 UTC strings,
-- booleans are INTEGER 0/1.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  github_id     INTEGER NOT NULL UNIQUE,
  github_login  TEXT NOT NULL,
  name          TEXT,
  email         TEXT,
  avatar_url    TEXT,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_github_login ON users (github_login COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY, -- sha256(token); the raw token only lives in the cookie
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS groups (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  from_name     TEXT NOT NULL DEFAULT '',
  from_email    TEXT NOT NULL DEFAULT '',
  reply_to      TEXT NOT NULL DEFAULT '',
  double_opt_in INTEGER NOT NULL DEFAULT 1,
  public_signup INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups (created_by);

CREATE TABLE IF NOT EXISTS group_admins (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'admin', -- owner | admin
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_admins_user ON group_admins (user_id);

-- Admins added by GitHub login before that person has ever signed in.
CREATE TABLE IF NOT EXISTS admin_invites (
  group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  github_login TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'admin',
  invited_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (group_id, github_login)
);
CREATE INDEX IF NOT EXISTS idx_admin_invites_login ON admin_invites (github_login COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS subscribers (
  id                TEXT PRIMARY KEY,
  group_id          TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  name              TEXT,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | active | unsubscribed | bounced | complained
  source            TEXT NOT NULL DEFAULT 'public',  -- public | admin | import | api
  confirm_token     TEXT UNIQUE,
  confirm_sent_at   TEXT,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  created_at        TEXT NOT NULL,
  confirmed_at      TEXT,
  unsubscribed_at   TEXT,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_group_email ON subscribers (group_id, email COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_subscribers_group_status ON subscribers (group_id, status);
CREATE INDEX IF NOT EXISTS idx_subscribers_confirm ON subscribers (confirm_token);

CREATE TABLE IF NOT EXISTS campaigns (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  subject      TEXT NOT NULL,
  body_md      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft', -- draft | sending | sent | failed
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  started_at   TEXT,
  sent_at      TEXT,
  total        INTEGER NOT NULL DEFAULT 0,
  sent_count   INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  cursor       TEXT -- subscriber id of the last processed recipient
);
CREATE INDEX IF NOT EXISTS idx_campaigns_group ON campaigns (group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_sends (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'sent', -- sent | failed | skipped
  provider_id   TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (campaign_id, subscriber_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_campaign ON campaign_sends (campaign_id, status);

-- Every transactional/campaign email is journaled here before delivery.
-- In local dev (EMAIL_PROVIDER=log) this is where you read confirmation links.
CREATE TABLE IF NOT EXISTS email_outbox (
  id          TEXT PRIMARY KEY,
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  html        TEXT NOT NULL,
  text        TEXT NOT NULL,
  kind        TEXT NOT NULL, -- confirm | welcome | campaign | test | admin_notice
  provider    TEXT NOT NULL,
  provider_id TEXT,
  status      TEXT NOT NULL DEFAULT 'queued', -- queued | sent | failed
  error       TEXT,
  created_at  TEXT NOT NULL,
  sent_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_created ON email_outbox (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_outbox_to ON email_outbox (to_email COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_email_outbox_provider ON email_outbox (provider_id);

-- Fixed-window rate limiting for public endpoints.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
