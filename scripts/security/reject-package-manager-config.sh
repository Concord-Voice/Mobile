#!/usr/bin/env bash
# Fail when the checkout tracks files that change what npm installs or what
# Node loads. See Concord-Voice/Mobile#82.
#  - .npmrc / .yarnrc: read by every npm command; node-options or script-shell
#    can change or skip the tests CI relies on.
#  - npm-shrinkwrap.json: npm ci prefers it over the owned package-lock.json.
#  - node_modules paths, and any symlink: Node loads a nearer node_modules (or
#    a symlink to one) before the installed package, so it can patch the very
#    checks that look for it.
#  - package.json outside the known packages: a "name" plus "exports"
#    self-reference makes require() resolve to a file beside it.
# Matching ignores case because macOS runners and developer Macs read .NPMRC
# as .npmrc.
set -euo pipefail

ALLOWED_PACKAGE_JSON=(
  package.json
  vendor/deepmerge/package.json
  .github/tools/eslint-formatter/package.json
  .github/tools/license-checker/package.json
)

list=$(mktemp)
trap 'rm -f "$list"' EXIT
# Written to files rather than piped so a git failure stops the script.
git -c core.quotePath=false ls-files -z --full-name -- \
  ':(top,glob,icase)**/.npmrc' \
  ':(top,glob,icase)**/.yarnrc' \
  ':(top,glob,icase)**/.yarnrc.yml' \
  ':(top,glob,icase)**/npm-shrinkwrap.json' \
  ':(top,glob,icase)**/node_modules' \
  ':(top,glob,icase)**/node_modules/**' >"$list"

stage=$(mktemp)
trap 'rm -f "$list" "$stage"' EXIT
git -c core.quotePath=false ls-files -z -s --full-name -- ':(top)' >"$stage"
while IFS= read -r -d '' entry; do
  path=${entry#*$'\t'}
  if [[ ${entry%% *} == 120000 ]]; then
    printf '%s\0' "$path" >>"$list"
  elif [[ ${path,,} == package.json || ${path,,} == */package.json ]]; then
    allowed=0
    for known in "${ALLOWED_PACKAGE_JSON[@]}"; do
      [[ $path == "$known" ]] && allowed=1
    done
    ((allowed)) || printf '%s\0' "$path" >>"$list"
  fi
done <"$stage"

if [[ -s "$list" ]]; then
  # One fixed annotation. Every output line of a name, including any part
  # after an embedded newline, starts with "path:", so a crafted filename
  # cannot start a workflow command even if the runner trims indentation.
  echo "::error::Tracked npm or Yarn config, npm-shrinkwrap.json, node_modules path, symlink or unexpected package.json is not allowed in this repository. Matching CODEOWNERS entries are case-sensitive; this check is the enforcing control."
  tr '\0' '\n' <"$list" | sed 's/^/path: /'
  exit 1
fi
echo "No tracked package-manager config, node_modules, symlinks or unexpected package.json."
