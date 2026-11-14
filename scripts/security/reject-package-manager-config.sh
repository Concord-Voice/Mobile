#!/usr/bin/env bash
# Fail when the checkout tracks npm or Yarn configuration files. A project
# .npmrc is read by every npm command, so node-options or script-shell in it
# can change or skip the tests CI relies on. See Concord-Voice/Mobile#82.
set -euo pipefail

found=$(git ls-files -- ':(glob)**/.npmrc' ':(glob)**/.yarnrc' ':(glob)**/.yarnrc.yml')
if [[ -n "$found" ]]; then
  while IFS= read -r file; do
    echo "::error file=${file}::Tracked package-manager config is not allowed in this repository."
  done <<<"$found"
  exit 1
fi
echo "No tracked package-manager config."
