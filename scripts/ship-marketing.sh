#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_ACCOUNT_ID="45ea71ff9c25ebe55521834446c581a1"
DRY_RUN=0
SKIP_DEPLOY=0

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    --skip-deploy)
      SKIP_DEPLOY=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: npm run ship:marketing -- [--dry-run] [--skip-deploy]" >&2
      exit 1
      ;;
  esac
done

cd "$ROOT_DIR"

CURRENT_BRANCH="$(git branch --show-current)"
if [[ -z "$CURRENT_BRANCH" ]]; then
  echo "Unable to determine the current git branch." >&2
  exit 1
fi

if [[ -n "$(git status --short)" ]]; then
  echo "Working tree must be clean before ship:marketing." >&2
  git status --short --branch
  exit 1
fi

echo "Building marketing dashboard..."
npm run build:marketing

echo "Pushing ${CURRENT_BRANCH} to origin and marketing..."
if [[ "$DRY_RUN" -eq 0 ]]; then
  git push origin "HEAD:${CURRENT_BRANCH}"
  git push marketing "HEAD:${CURRENT_BRANCH}"
  git push origin HEAD:main
  git push marketing HEAD:main
else
  echo "DRY RUN: git push origin HEAD:${CURRENT_BRANCH}"
  echo "DRY RUN: git push marketing HEAD:${CURRENT_BRANCH}"
  echo "DRY RUN: git push origin HEAD:main"
  echo "DRY RUN: git push marketing HEAD:main"
fi

if [[ "$SKIP_DEPLOY" -eq 1 ]]; then
  echo "Skipping production deploy because --skip-deploy was set."
  exit 0
fi

echo "Checking Cloudflare account access..."
WHOAMI_JSON="$(npx wrangler whoami --json)"
if ! printf '%s' "$WHOAMI_JSON" | node -e '
  const fs = require("node:fs");
  const accountId = process.argv[1];
  const payload = JSON.parse(fs.readFileSync(0, "utf8"));
  const ok = Array.isArray(payload.accounts) && payload.accounts.some((account) => account.id === accountId);
  process.exit(ok ? 0 : 1);
' "$PROD_ACCOUNT_ID"; then
  echo "Current Wrangler login does not include the production Cloudflare account ${PROD_ACCOUNT_ID}." >&2
  echo "Log into the production account, then rerun: npm run ship:marketing" >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "DRY RUN: npx wrangler deploy --config wrangler.marketing.jsonc"
  exit 0
fi

echo "Deploying marketing dashboard to production..."
npx wrangler deploy --config wrangler.marketing.jsonc
