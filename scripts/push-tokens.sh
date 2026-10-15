#!/bin/zsh
# Runs on your Mac (launchd, every 6h): refresh the token ledger and push it.
# The push triggers the Action, which re-renders the SVG.
set -e
export PATH="/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "${0:A:h}/.."
git pull --rebase --quiet
node scripts/sync-tokens.mjs
git add data/tokens.json data/tokens-manual.json 2>/dev/null || git add data/tokens.json
git diff --cached --quiet || { git commit -qm "chore: sync token usage"; git push -q; }
