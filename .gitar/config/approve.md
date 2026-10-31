# Gitar auto-approval criteria — Mobile

Gitar may approve ONLY when every condition below holds. When in doubt, do not approve; leave the PR for a human.

1. The PR changes no agent instruction or review-config file: `CLAUDE.md`, `AGENTS.md`, `agent.md`, any `SKILL.md`, anything under `.claude/`, `.agents/` or `.gitar/`, or any `CODEOWNERS` file.
2. The PR changes no CI, supply-chain or scanner file: `.github/workflows/`, `.github/scripts/`, `.github/ci/`, `.github/codeql/`, `.pre-commit-config.yaml`, `sonar-project.properties`, `.semgrep/`, `.gitleaks.toml`, `.secrets.baseline`, eslint or golangci config, Dockerfiles, `package.json`, `package-lock.json`, `Gemfile`, `Gemfile.lock`, `ios/Podfile`, `ios/Podfile.lock`, `*.podspec`.
3. The PR changes no security-sensitive path: any path containing `auth`, `mfa`, `rbac`, `session`, `password`, `token`, `crypto`, `e2ee`, `encryption`, `attest`, `signing` or `migrations`, or anything under `infrastructure/` or `scripts/security/`.
3a. The PR changes nothing under `native/`, `ios/ConcordVoice.xcodeproj/`, or any `Info.plist`, `*.entitlements` or Android signing or manifest file.
4. The PR has none of these labels: `risk: hotfix`, `risk: security`, `risk: privacy`, `risk: breaking-change`, `risk: data-loss`.
5. All Gitar findings are resolved, and no other reviewer has an unresolved or change-requesting comment.

CI status is enforced by the repository's required checks, not by this file.
