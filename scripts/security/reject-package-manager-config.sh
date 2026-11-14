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
# as .npmrc; paths with the two non-ASCII letters that fold to ASCII fail too.
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
pkgs=$(mktemp)
trap 'rm -f "$list" "$stage" "$pkgs"' EXIT
# Bash 3.2 (the macOS runner's bash) has no ${var,,}, so git does the
# case-insensitive matching and the allowlist comparison stays exact.
git -c core.quotePath=false ls-files -z -s --full-name -- ':(top)' >"$stage"
# U+017F (long s) and U+212A (Kelvin sign) are the only non-ASCII letters
# whose case fold is ASCII: macOS opens package.j\u017Fon as package.json, but
# git icase and CODEOWNERS only fold ASCII. Written as UTF-8 bytes for bash 3.2.
fold_s=$'\xc5\xbf'
fold_k=$'\xe2\x84\xaa'
while IFS= read -r -d '' entry; do
  path=${entry#*$'\t'}
  if [[ ${entry%% *} == 120000 || $path == *"$fold_s"* || $path == *"$fold_k"* ]]; then
    printf '%s\0' "$path" >>"$list"
  fi
done <"$stage"
git -c core.quotePath=false ls-files -z --full-name -- ':(top,glob,icase)**/package.json' >"$pkgs"
while IFS= read -r -d '' path; do
  allowed=0
  for known in "${ALLOWED_PACKAGE_JSON[@]}"; do
    [[ $path == "$known" ]] && allowed=1
  done
  ((allowed)) || printf '%s\0' "$path" >>"$list"
done <"$pkgs"

if [[ -s "$list" ]]; then
  # One fixed annotation. Every output line of a name, including any part
  # after an embedded newline, starts with "path:", so a crafted filename
  # cannot start a workflow command even if the runner trims indentation.
  echo "::error::Tracked npm or Yarn config, npm-shrinkwrap.json, node_modules path, symlink or unexpected package.json is not allowed in this repository. Matching CODEOWNERS entries are case-sensitive; this check is the enforcing control."
  tr '\0\r' '\n' <"$list" | sed 's/^/path: /'
  exit 1
fi
echo "No tracked package-manager config, node_modules, symlinks or unexpected package.json."
