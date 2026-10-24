#!/usr/bin/env bash
# narrow-security-profiles.sh — ADR-0017 / #1430
#
# Retires SonarCloud's redundant security-taint sensors for Concord-Voice-Alpha
# by deactivating the `injection`-tagged VULNERABILITY (taint) rules in custom
# quality profiles. Per Sonar staff guidance (community thread 96503), the
# JsSecuritySensor / Go security sensor skip their analysis entirely when no
# injection vulnerability rules are active — this is the supported mechanism
# (no scanner property exists). The taint classes are owned by CodeQL
# (security-extended, #1424) + Semgrep (#1426) per ADR-0017.
#
# WHAT THIS IS NOT (AI-Code-Assurance compatibility, LEGACY-INSTRUCTIONS.md):
#   - NOT rule suppression/tuning on AI-authored code: this is the recorded
#     ADR-0017 architecture change (security detection re-homed to Code
#     Scanning). Hotspot rules, DBD sensors, and all maintainability/
#     reliability rules remain active. Quality Gate thresholds untouched.
#
# Usage:
#   SONAR_TOKEN=<token> ./scripts/sonar/narrow-security-profiles.sh           # dry-run
#   SONAR_TOKEN=<token> ./scripts/sonar/narrow-security-profiles.sh --apply   # mutate
#
# Idempotent: re-running re-deactivates already-inactive rules (API no-op) and
# reuses existing "Concord way" profiles.

set -euo pipefail

ORG="concord-voice"
PROJECT="Concord-Voice-Alpha"
API="https://sonarcloud.io/api"
LANGUAGES=("js" "ts" "go")
APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true

if [[ -z "${SONAR_TOKEN:-}" ]]; then
  echo "ERROR: SONAR_TOKEN must be set (SonarCloud user token with Administer Quality Profiles permission)." >&2
  exit 1
fi

scurl() { curl --fail --silent --show-error -u "$(printf '%s:' "$SONAR_TOKEN")" "$@"; }

total_deactivated=0

for lang in "${LANGUAGES[@]}"; do
  echo "── Language: ${lang} ─────────────────────────────────────────────"

  profile_name="Concord way (${lang}) — ADR-0017 narrowed"

  # Find an existing narrowed profile, else the project's currently-active one.
  # first() inside jq (not `| head -1`): head closing the pipe early SIGPIPEs
  # jq/curl under pipefail — the same intermittent-abort class hit on
  # codeql.yml's module guard (#1441).
  existing_key=$(scurl "${API}/qualityprofiles/search?organization=${ORG}&language=${lang}" \
    | jq -r --arg n "${profile_name}" 'first(.profiles[] | select(.name == $n) | .key) // empty')

  if [[ -n "${existing_key}" ]]; then
    profile_key="${existing_key}"
    echo "Reusing existing profile: ${profile_name} (${profile_key})"
  else
    # The profile currently used by the project (falls back to the language default).
    src_json=$(scurl "${API}/qualityprofiles/search?organization=${ORG}&language=${lang}&project=${PROJECT}")
    src_key=$(printf '%s' "${src_json}" | jq -r '.profiles[0].key')
    src_name=$(printf '%s' "${src_json}" | jq -r '.profiles[0].name')
    echo "Source profile: ${src_name} (${src_key})"
    if $APPLY; then
      profile_key=$(scurl -X POST "${API}/qualityprofiles/copy" \
        --data-urlencode "fromKey=${src_key}" \
        --data-urlencode "toName=${profile_name}" | jq -r '.key')
      echo "Created profile: ${profile_name} (${profile_key})"
    else
      profile_key="<dry-run: would copy ${src_key} to '${profile_name}'>"
      echo "[dry-run] would create profile '${profile_name}' from ${src_key}"
    fi
  fi

  # Enumerate the taint-class VULNERABILITY rules for this language live — no
  # hardcoded rule list to drift. The rules live in the dedicated security
  # repository (js->jssecurity, ts->tssecurity, go->gosecurity); the modern
  # taint rules DROPPED the legacy `injection` tag (they are CWE-tagged now,
  # e.g. gosecurity:S3649 sysTags=[cwe,sql]), so the old `tags=injection` filter
  # matched ZERO and this loop deactivated nothing — verified live 2026-06-17
  # (tags=injection => 0; repositories=<lang>security => 9/49/49 for go/js/ts).
  # types=VULNERABILITY structurally excludes security hotspots (different type),
  # which stay active. Do NOT drop the repositories filter for a bare
  # languages+types query: that over-selects ~50 non-taint VULNERABILITY rules
  # (hardcoded creds, weak crypto), out of ADR-0017 scope.
  rules=$(scurl "${API}/rules/search?organization=${ORG}&languages=${lang}&types=VULNERABILITY&repositories=${lang}security&ps=500" \
    | jq -r '.rules[].key')
  count=$(printf '%s\n' "${rules}" | grep -c . || true)
  echo "Taint VULNERABILITY rules for ${lang}: ${count}"

  while IFS= read -r rule; do
    [[ -z "${rule}" ]] && continue
    if $APPLY; then
      scurl -X POST "${API}/qualityprofiles/deactivate_rule" \
        --data-urlencode "key=${profile_key}" \
        --data-urlencode "rule=${rule}" > /dev/null
      echo "deactivated: ${rule}"
    else
      echo "[dry-run] would deactivate: ${rule}"
    fi
    total_deactivated=$((total_deactivated + 1))
  done <<< "${rules}"

  if $APPLY; then
    scurl -X POST "${API}/qualityprofiles/add_project" \
      --data-urlencode "organization=${ORG}" \
      --data-urlencode "language=${lang}" \
      --data-urlencode "qualityProfile=${profile_name}" \
      --data-urlencode "project=${PROJECT}" > /dev/null
    echo "Assigned '${profile_name}' to ${PROJECT}"
  else
    echo "[dry-run] would assign '${profile_name}' to ${PROJECT}"
  fi
done

echo "──────────────────────────────────────────────────────────────────"
if $APPLY; then
  echo "DONE: ${total_deactivated} taint-rule deactivations across ${#LANGUAGES[@]} languages."
  echo "Verify: next PR analysis should skip JsSecuritySensorV2 / Go security sensor"
  echo "(<5 min wall-clock, #1381 resolved). Quality Gate conditions are untouched."
else
  echo "DRY-RUN complete: ${total_deactivated} rules would be deactivated. Re-run with --apply."
fi
