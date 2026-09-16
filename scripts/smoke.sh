#!/usr/bin/env bash
# End-to-end smoke test for CF-Email-Groups against a local dev server.
# Works in both single-list mode (the default) and multi-list mode.
# Requires: a running dev server with DEV_AUTH=1, curl, jq.
#
#   pnpm dev            # in one terminal
#   pnpm smoke          # in another
#
set -euo pipefail

BASE="${BASE:-http://localhost:4321}"
JAR="$(mktemp)"
TMP="$(mktemp -d)"
LIST_CREATED=0
GROUP_ID=""
SUBSCRIBER_ID=""
CAMPAIGN_ID=""
USER_ID=""
cleanup() {
  set +e
  if [ -n "$SUBSCRIBER_ID" ] && [ -n "$GROUP_ID" ]; then
    json -X DELETE "$BASE/api/groups/$GROUP_ID/subscribers/$SUBSCRIBER_ID" >/dev/null 2>&1
  fi
  if [ -n "$CAMPAIGN_ID" ]; then
    json -X DELETE "$BASE/api/campaigns/$CAMPAIGN_ID" >/dev/null 2>&1
  fi
  if [ "$LIST_CREATED" = "1" ] && [ -n "$GROUP_ID" ]; then
    json -X DELETE "$BASE/api/groups/$GROUP_ID" -H 'content-type: application/json' \
      -d "{\"confirmSlug\":\"$GROUP_SLUG\"}" >/dev/null 2>&1
  fi
  # In single-list mode the smoke user joins as an admin; remove it again.
  if [ -n "$USER_ID" ] && [ -n "$GROUP_ID" ]; then
    json -X DELETE "$BASE/api/groups/$GROUP_ID/admins/$USER_ID" >/dev/null 2>&1
  fi
  rm -rf "$JAR" "$TMP"
}
trap cleanup EXIT

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

json() { curl -fsS -b "$JAR" -c "$JAR" "$@"; }

step "0 · Server reachable"
curl -fsS -m 5 "$BASE/api/health" | jq -e '.ok == true' >/dev/null || fail "no healthy server at $BASE"
pass "$BASE/api/health"

if ! json "$BASE/api/dev/outbox?limit=1" >/dev/null 2>&1; then
  fail "DEV_AUTH is not enabled (or this is not a dev server). Run with .dev.vars containing DEV_AUTH=1."
fi
pass "DEV_AUTH mailbox available"

SUFFIX="$(date +%s)"
LOGIN="smoke-$SUFFIX"
EMAIL="smoke-$SUFFIX@example.com"
GROUP_SLUG=""

step "1 · Dev sign-in"
json -L -o /dev/null "$BASE/api/auth/dev?login=$LOGIN" || fail "dev sign-in failed"
ME="$(json "$BASE/api/me")"
[ "$(echo "$ME" | jq -r '.user.login')" = "$LOGIN" ] || fail "session cookie was not accepted"
USER_ID="$(echo "$ME" | jq -r '.user.id')"

GROUP_COUNT="$(echo "$ME" | jq -r '.groups | length')"
if [ "$GROUP_COUNT" -gt 0 ]; then
  GID="$(echo "$ME" | jq -r '.groups[0].id')"
  GROUP_SLUG="$(echo "$ME" | jq -r '.groups[0].slug')"
  MODE="single-list"
else
  GROUP_CREATED="$(json -X POST "$BASE/api/groups" -H 'content-type: application/json' \
    -d "{\"name\":\"Smoke List $SUFFIX\",\"description\":\"Created by scripts/smoke.sh\"}")"
  GID="$(echo "$GROUP_CREATED" | jq -r '.group.id')"
  GROUP_SLUG="$(echo "$GROUP_CREATED" | jq -r '.group.slug')"
  LIST_CREATED=1
  MODE="multi-list"
fi
GROUP_ID="$GID"
pass "signed in as $LOGIN ($MODE mode, /join/$GROUP_SLUG)"

step "2 · Public sign-up"
SUB="$(curl -fsS -X POST "$BASE/api/public/subscribe" -H 'content-type: application/json' \
  -d "{\"slug\":\"$GROUP_SLUG\",\"email\":\"$EMAIL\",\"name\":\"Smoke Tester\"}")"
echo "$SUB" | jq -e '.ok == true' >/dev/null || fail "subscribe response: $SUB"
REQUIRES_CONFIRM="$(echo "$SUB" | jq -r '.requiresConfirmation')"
if [ "$REQUIRES_CONFIRM" = "true" ]; then
  pass "subscriber pending confirmation"
else
  pass "subscriber activated immediately (double opt-in disabled)"
fi

step "3 · Confirmation + welcome email"
if [ "$REQUIRES_CONFIRM" = "true" ]; then
  CONFIRM_URL=""
  for _ in $(seq 1 20); do
    CONFIRM_HTML="$(json "$BASE/api/dev/outbox?to=$EMAIL&kind=confirm" | jq -r '.emails[0].html // empty')"
    CONFIRM_URL="$(printf '%s' "$CONFIRM_HTML" | grep -oE 'https?://[^"< ]*/confirm\?token=[^"< ]+' | head -1 || true)"
    [ -n "$CONFIRM_URL" ] && break
    sleep 0.5
  done
  [ -n "$CONFIRM_URL" ] || fail "confirm email never arrived in the outbox"
  curl -fsS "$CONFIRM_URL" | grep -q 'Subscription confirmed' || fail "confirmation page did not confirm"
  pass "confirmation link worked"
fi

ACTIVE="$(json "$BASE/api/groups/$GID/subscribers?status=active&q=$EMAIL")"
[ "$(echo "$ACTIVE" | jq -r '.total')" = "1" ] || fail "subscriber did not become active"
ACTIVE_TOTAL="$(json "$BASE/api/groups/$GID/subscribers?status=active" | jq -r '.total')"
SUBSCRIBER_ID="$(echo "$ACTIVE" | jq -r '.subscribers[0].id')"
WELCOME_HTML="$(json "$BASE/api/dev/outbox?to=$EMAIL&kind=welcome" | jq -r '.emails[0].html // empty')"
UNSUB_URL="$(printf '%s' "$WELCOME_HTML" | grep -oE 'https?://[^"< ]*/unsubscribe\?token=[^"< ]+' | head -1 || true)"
[ -n "$UNSUB_URL" ] || fail "welcome email has no unsubscribe link"
pass "active + personal unsubscribe link present"

step "4 · Create campaign"
CAMPAIGN="$(json -X POST "$BASE/api/groups/$GID/campaigns" -H 'content-type: application/json' \
  -d '{"subject":"Smoke test campaign","bodyMd":"# Hello\n\nThis is **smoke tested**.\n\n- one\n- two"}')"
CAMPAIGN_ID="$(echo "$CAMPAIGN" | jq -r '.campaign.id')"
[ "$CAMPAIGN_ID" != "null" ] || fail "campaign was not created"

if [ "$LIST_CREATED" = "1" ] || [ "$ACTIVE_TOTAL" -le 1 ]; then
  SEND="$(json -X POST "$BASE/api/campaigns/$CAMPAIGN_ID/send" -H 'content-type: application/json' -d '{"batchSize":25}')"
  echo "$SEND" | jq -e '.done == true and .sent >= 1 and .failed == 0' >/dev/null || fail "send progress: $SEND"
  CAMPAIGN_STATUS="$(json "$BASE/api/dev/outbox?to=$EMAIL&kind=campaign" | jq -r '.emails[0].status')"
  [ "$CAMPAIGN_STATUS" = "sent" ] || fail "campaign was not recorded as sent"
  pass "campaign delivered (1 recipient)"
else
  # The dedicated list has real subscribers; only send a test to ourselves.
  json -X POST "$BASE/api/campaigns/$CAMPAIGN_ID/test" -H 'content-type: application/json' \
    -d "{\"to\":\"$EMAIL\"}" | jq -e '.ok == true' >/dev/null || fail "test send failed"
  pass "campaign created + test send only (single-list mode has $ACTIVE_TOTAL active subscribers)"
fi

step "5 · RFC 8058 one-click unsubscribe"
ONECLICK_URL="${UNSUB_URL/\/unsubscribe?/\/api\/public\/unsubscribe?}"
curl -fsS -X POST "$ONECLICK_URL" -H 'content-type: application/x-www-form-urlencoded' \
  -d 'List-Unsubscribe=One-Click' | jq -e '.ok == true' >/dev/null || fail "one-click POST failed"
FINAL="$(json "$BASE/api/groups/$GID/subscribers?q=$EMAIL")"
[ "$(echo "$FINAL" | jq -r '.subscribers[0].status')" = "unsubscribed" ] || fail "subscriber was not unsubscribed"
pass "one-click unsubscribe processed"

step "6 · CSV export + cleanup"
json "$BASE/api/groups/$GID/export" | grep -q "$EMAIL" || fail "CSV export is missing the subscriber"
pass "CSV export contains the subscriber"
printf '\n\033[32mAll smoke checks passed.\033[0m\n'
