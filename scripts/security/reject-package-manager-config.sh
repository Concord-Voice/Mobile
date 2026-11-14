#!/usr/bin/env bash
# Fail when the checkout tracks files that change what npm runs. npm reads a
# project .npmrc for every command, so node-options or script-shell in it can
# change or skip the tests CI relies on. A tracked node_modules directory, for
# example scripts/node_modules/deepmerge, is loaded before the installed
# package and can patch the very checks that look for it. Matching ignores
# case because macOS runners and developer Macs read .NPMRC as .npmrc.
# See Concord-Voice/Mobile#82.
set -euo pipefail

list=$(mktemp)
trap 'rm -f "$list"' EXIT
# Written to a file rather than piped so a git failure stops the script.
git -c core.quotePath=false ls-files -z -- \
  ':(top,glob,icase)**/.npmrc' \
  ':(top,glob,icase)**/.yarnrc' \
  ':(top,glob,icase)**/.yarnrc.yml' \
  ':(top,glob,icase)**/node_modules/**' >"$list"

found=0
while IFS= read -r -d '' file; do
  found=1
  echo "::error file=${file}::Tracked npm or Yarn config, or a tracked node_modules file, is not allowed in this repository."
done <"$list"

if ((found)); then
  exit 1
fi
echo "No tracked package-manager config or node_modules."
