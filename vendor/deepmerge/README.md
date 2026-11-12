# Patched development-tooling merge dependency

This private local package preserves deepmerge 4.3.1's CommonJS API and types for
React Native CLI/config/doctor and Jest. The root npm override applies to every
installed deepmerge edge. A direct development dependency anchors the file path
at the repository root; the override references it with `$deepmerge`. It has no
install script, runtime dependency or network operation, and is usable with
`npm ci --ignore-scripts`.

## Provenance

- Upstream: https://github.com/TehShrike/deepmerge
- npm release: `deepmerge@4.3.1` (latest registry tag verified 2026-11-09)
- Source commit: `5b87756a5671635679001cbac72aa42f23472c81`
- Tarball: https://registry.npmjs.org/deepmerge/-/deepmerge-4.3.1.tgz
- Tarball integrity: `sha512-3sUqbMEc77XqpdNO7FRyRog+eW3ph+GYCbj+rK+uYyRMuwsVy0rMiVtPn+QJlKFvWP/1PYpapqYn0Me2knFn+A==`
- `index.cjs` derives from the release's bundled `dist/cjs.js`, including its
  is-mergeable-object implementation. The release's MIT license is retained in
  `LICENSE`; original types are retained verbatim in `index.d.ts`.

Original SHA-256 values:

- `dist/cjs.js`: `2e5160f84a1141bd927264afe4d15766f1e6cf07daef182b37ff53fea121de7d`
- `index.d.ts`: `146ba4b99c5feb82663e17a671bf9f53bb39c704cd76345d6c5a801c26372f44`
- `license.txt`: `6cfc4687cb2f2d86f4a77e6b526290d3878e5e512f3fec2f4cb36a9cb36f798b`

## Security change

GHSA-gcqx-w48m-w2h4 allows an own `__proto__` key to change a returned object's
prototype through target copying, null-prototype targets or nested merging.
The shared key enumerator discards `__proto__` from both target and source before
any destination assignment. Merely retaining it as an own data property is unsafe:
Jest subsequently copies globals with `Object.assign`, invoking the prototype
setter there. The regression exercises the real Jest environment construction.
Existing clone, array, symbol, customMerge and unsafe-source-key behavior remains.
Caller-supplied merge callbacks and `clone: false` may deliberately return existing
objects; this package is not a general-purpose sanitizer for those objects.
This prevents poisoning of returned objects; the advisory is not a claim that
Object.prototype itself is globally polluted.

The old scanner exception was removed: an isolated fixture reproduced inherited
attacker-controlled values through the actual Jest preset/globals loader. Current
application configuration does not use that globals merge, but development-only
status and the ability of some config files to execute code are insufficient
reasons to dismiss the dependency bug. No remote application exploit is claimed.
The private package identity records a real maintained patch, not an upstream
fixed version. Scanner disappearance alone is not proof of remediation.

## Verification and removal

`npm run test:dependency-compat` checks hostile keys and actual CLI/config/doctor
and Jest consumers. Use clean installs both with and without lifecycle scripts;
all four parent resolutions must use this local package. Ordinary app tests,
lint, typecheck, supply-chain scans and native CI remain required.

Because the lockfile links this package instead of a versioned registry entry,
dependency scanners will not match a future deepmerge advisory against it.
`concord.reviewBy` in `package.json` carries the re-check deadline the removed
scanner exception used to carry; the compatibility test fails after that date
until someone re-checks upstream advisories and releases and moves it. It
reports the due date for the last 30 days before failing, as a GitHub warning
annotation in Actions. Set `CONCORD_SKIP_REVIEW_DEADLINE=1` only to bisect or
rebuild a historical commit locally; the test rejects it when `CI` or
`GITHUB_ACTIONS` is set.
The security team owns `vendor/` and the files that keep this patch in force
(`package.json`, `package-lock.json`, the compatibility tests, the root
`postinstall` script and every `CODEOWNERS` location).

Remove this override and directory when an upstream release or parent replacement
fixes the behavior and passes these same compatibility and regression cases.
Keep the upstream license and this provenance with any copied implementation.
