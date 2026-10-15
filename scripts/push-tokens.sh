#!/bin/zsh
# Runs on your Mac (launchd, every 6h): refresh the token ledger and push it.
# Also renders the SVG here, so it stays fresh even without the Action.
set -e
export PATH="/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "${0:A:h}/.."
git pull --rebase --quiet
node scripts/sync-tokens.mjs
node scripts/build.mjs
git add data/tokens.json assets/readme.svg
git diff --cached --quiet || { git commit -qm "chore: sync token usage"; git push -q; }
