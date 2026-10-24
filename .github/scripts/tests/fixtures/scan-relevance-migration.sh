#!/usr/bin/env bash
# Review 30 full-mode canaries, then observe one reversible protected-mode shadow trial.
# Dry-run is read-only against GitHub and stores the exact reviewed snapshots.
set -euo pipefail
umask 077

readonly ORG=Concord-Voice
readonly REPO=Concord-Voice-Alpha
readonly REPO_ID=1158152129
readonly ORG_RULE_ID=17153062
readonly WORKFLOW_CUSTODY_RULE_ID=24555855
readonly REPO_SCAN_RULE_ID=17541948
readonly WORKFLOW='.github/workflows/required-pr-build.yml'
# shortcut: this reviewed pin tracks required-pr-build.yml; update both together when its target changes.
readonly PR_CI_SHA='cb10844a7860092011f96b4607682ef2e6c55a80' # pragma: allowlist secret -- public commit
readonly WORKFLOW_RULE_NAME='Alpha Required PR Build'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly NATIVE_SCAN_SPEC="${SCRIPT_DIR}/alpha-code-scanning-ruleset.json"
readonly REQUIRED_WORKFLOW_SPEC="${SCRIPT_DIR}/alpha-required-workflow-ruleset.json"

mode=--dry-run
mode_seen=false
snapshot_dir=
canary_evidence=
run_id=
while (($#)); do
  case "$1" in
    --dry-run|--shadow-trial)
      [[ "$mode_seen" == false ]] || {
        echo 'ERROR: choose exactly one of --dry-run or --shadow-trial' >&2; exit 2;
      }
      mode=$1; mode_seen=true; shift ;;
    --snapshot-dir|--canary-evidence|--run-id)
      (($# >= 2)) || { echo "ERROR: $1 requires a path" >&2; exit 2; }
      case "$1" in
        --snapshot-dir) snapshot_dir=$2 ;;
        --canary-evidence) canary_evidence=$2 ;;
        --run-id) run_id=$2 ;;
      esac
      shift 2 ;;
    --apply) echo "ERROR: lasting --apply cutover is disabled; use --shadow-trial" >&2; exit 2 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$snapshot_dir" ]] || { echo 'ERROR: --snapshot-dir DIR is required' >&2; exit 2; }
if [[ "$mode" == --shadow-trial ]]; then
  [[ -n "$canary_evidence" && -f "$canary_evidence" && "$run_id" =~ ^[1-9][0-9]*$ ]] || {
    echo 'ERROR: --shadow-trial requires --canary-evidence FILE and --run-id N' >&2; exit 2;
  }
  [[ -d "$snapshot_dir" ]] || { echo 'ERROR: reviewed snapshot directory does not exist' >&2; exit 2; }
else
  mkdir -p "$snapshot_dir"
fi

command -v gh >/dev/null || { echo 'ERROR: gh CLI is required' >&2; exit 2; }
command -v jq >/dev/null || { echo 'ERROR: jq is required' >&2; exit 2; }

die() { echo "ERROR: $*" >&2; exit 1; }
api() { gh api "$@"; }
canonical() { jq -S -c .; }
save_snapshot() {
  local name=$1 value=$2 temp
  temp=$(mktemp "${snapshot_dir}/.${name}.XXXXXX") || die "cannot stage snapshot ${name}"
  printf '%s\n' "$value" | canonical > "$temp" || { rm -f "$temp"; die "cannot write snapshot ${name}"; }
  mv -f "$temp" "${snapshot_dir}/${name}.json" || die "cannot install snapshot ${name}"
}

read_live() {
  org_rule=$(api "orgs/${ORG}/rulesets/${ORG_RULE_ID}") || die 'cannot read live org ruleset 17153062'
  workflow_custody_rule=$(api "orgs/${ORG}/rulesets/${WORKFLOW_CUSTODY_RULE_ID}") || die 'cannot read live workflow custody rule 24555855'
  repo_rule=$(api "repos/${ORG}/${REPO}/rulesets/${REPO_SCAN_RULE_ID}") || die 'cannot read live repo ruleset 17541948'
  effective=$(api "repos/${ORG}/${REPO}/rules/branches/main" --paginate | jq -se 'if length > 0 and all(.[]; type == "array" and length > 0) then add else error("unknown effective rules page shape") end') || die 'cannot read complete effective main rules'
  rulesets=$(api --paginate "orgs/${ORG}/rulesets?per_page=100" | jq -s 'add') || die 'cannot list live org rulesets'
  workflow_rule_id=$(printf '%s' "$rulesets" | jq -er --arg n "$WORKFLOW_RULE_NAME" '[.[] | select(.name == $n) | .id] | if length == 1 then .[0] else error("missing or duplicate workflow rule") end' 2>/dev/null) \
    || die 'protected required workflow is not active'
  workflow_rule=$(api -H 'Time-Zone: UTC' "orgs/${ORG}/rulesets/${workflow_rule_id}") || die 'protected required workflow is not active'
  main_commit=$(api "repos/${ORG}/${REPO}/commits/main") || die 'cannot read protected main commit'
  workflow=$(api "repos/${ORG}/${REPO}/actions/workflows/required-pr-build.yml") || die 'cannot read protected workflow metadata'
  mode_variable=$(api "repos/${ORG}/${REPO}/actions/variables/CI_SCAN_RELEVANCE_MODE") || die 'cannot read live CI_SCAN_RELEVANCE_MODE'
  open_prs=$(api --paginate "repos/${ORG}/${REPO}/pulls?state=open&per_page=100" | jq -s 'add | map({number, head_sha: .head.sha}) | sort_by(.number)') \
    || die 'cannot read complete open PR head inventory'
}

write_snapshots() {
  save_snapshot org-ruleset-17153062 "$org_rule"
  save_snapshot org-workflow-custody-24555855 "$workflow_custody_rule"
  save_snapshot repo-ruleset-17541948 "$repo_rule"
  save_snapshot effective-branch-rules "$effective"
  save_snapshot workflow-ruleset "$workflow_rule"
  save_snapshot open-pr-heads "$open_prs"
  save_snapshot main-commit "$main_commit"
  save_snapshot workflow-metadata "$workflow"
  save_snapshot scan-mode-variable "$mode_variable"
}

load_reviewed() {
  local name current
  for name in org-ruleset-17153062 org-workflow-custody-24555855 repo-ruleset-17541948 effective-branch-rules workflow-ruleset open-pr-heads main-commit workflow-metadata scan-mode-variable; do
    [[ -s "${snapshot_dir}/${name}.json" ]] || die "reviewed snapshot missing: ${name}.json"
  done
  local -a names=(org-ruleset-17153062 org-workflow-custody-24555855 repo-ruleset-17541948 effective-branch-rules workflow-ruleset open-pr-heads main-commit workflow-metadata scan-mode-variable)
  local -a values=("$org_rule" "$workflow_custody_rule" "$repo_rule" "$effective" "$workflow_rule" "$open_prs" "$main_commit" "$workflow" "$mode_variable")
  for i in "${!names[@]}"; do
    current=$(printf '%s' "${values[$i]}" | canonical) || die "live snapshot malformed: ${names[$i]}"
    [[ "$current" == "$(cat "${snapshot_dir}/${names[$i]}.json")" ]] || die "live ${names[$i]} changed since review"
  done
}

validate_policy() {
  local expected actual ref
  # The rule list has no meaningful order, so compare it sorted by type.
  local normalize='{name,target,enforcement,conditions,bypass_actors,
    rules:([.rules[] | if .type == "workflows" or .type == "required_status_checks" then
      .parameters.do_not_enforce_on_create = (.parameters.do_not_enforce_on_create // false)
    else . end] | sort_by(.type))}'
  expected=$(jq -ceS "$normalize" "$REQUIRED_WORKFLOW_SPEC") || die 'committed required workflow policy is malformed'
  actual=$(jq -ceS "$normalize" <<< "$workflow_rule") || die 'live required workflow policy is malformed'
  [[ "$actual" == "$expected" ]] || die 'protected required workflow policy differs from committed Alpha contract'
  # The ref the committed contract names, not a literal: it is what must be effective.
  ref=$(jq -er '[.rules[] | select(.type == "workflows") | .parameters.workflows[].ref]
    | if length == 1 then .[0] else error("ambiguous workflow ref") end' "$REQUIRED_WORKFLOW_SPEC") \
    || die 'committed required workflow ref is missing or ambiguous'
  jq -e --arg path "$WORKFLOW" --argjson repo "$REPO_ID" --argjson rule "$workflow_rule_id" --arg ref "$ref" '
    type == "array" and any(.[]; .ruleset_id == $rule and .type == "workflows" and any(.parameters.workflows[]?;
      .repository_id == $repo and .path == $path and .ref == $ref))
  ' <<< "$effective" >/dev/null || die 'protected required workflow is not effective on main'
  jq -e '.sha | test("^[0-9a-f]{40}$")' <<< "$main_commit" >/dev/null \
    || die 'protected main revision is malformed'
  jq -e '.id != null and .path == ".github/workflows/required-pr-build.yml"' <<< "$workflow" >/dev/null \
    || die 'protected workflow metadata is malformed'
}

require_workflow_custody() {
  jq -e --argjson id "$WORKFLOW_CUSTODY_RULE_ID" '
    .id == $id and .target == "push" and .enforcement == "active" and
    .conditions == {repository_name:{include:["~ALL"],exclude:[]}} and
    .rules == [{type:"file_path_restriction",parameters:{ignored_file_paths:[],restricted_file_paths:[".github/workflows/**/*"]}}] and
    ([.bypass_actors[] | {actor_id,actor_type,bypass_mode}] | sort_by(.actor_id)) ==
      [{actor_id:29110,actor_type:"Integration",bypass_mode:"always"},
       {actor_id:19157787,actor_type:"Team",bypass_mode:"always"}]
  ' <<< "$1" >/dev/null || die 'workflow custody push rule is missing or changed'
}

check_native_codeql_tuple() {
  local org_codeql repo_codeql expected
  expected='{"tool":"CodeQL","alerts_threshold":"errors_and_warnings","security_alerts_threshold":"medium_or_higher"}'
  org_codeql=$(jq -ce '
    [.rules[]? | select(.type == "code_scanning") | .parameters.code_scanning_tools[]?
      | select(.tool == "CodeQL")
      | {tool,alerts_threshold,security_alerts_threshold}]
    | if length == 1 then .[0] else error("missing or duplicate CodeQL tuple") end
  ' <<< "$org_rule" 2>/dev/null) || die 'organization CodeQL native requirement is missing or ambiguous'
  repo_codeql=$(jq -ce '
    [.rules[]? | select(.type == "code_scanning") | .parameters.code_scanning_tools[]?
      | select(.tool == "CodeQL")
      | {tool,alerts_threshold,security_alerts_threshold}]
    | if length == 1 then .[0] else error("missing or duplicate CodeQL tuple") end
  ' <<< "$repo_rule" 2>/dev/null) || die 'repository CodeQL native requirement is missing or ambiguous'
  [[ "$(jq -S -c . <<< "$org_codeql")" == "$(jq -S -c . <<< "$expected")" &&
     "$(jq -S -c . <<< "$repo_codeql")" == "$(jq -S -c . <<< "$expected")" &&
     "$(jq -S -c . <<< "$org_codeql")" == "$(jq -S -c . <<< "$repo_codeql")" ]] \
    || die 'organization and repository CodeQL native requirement must match errors_and_warnings / medium_or_higher'
}

require_effective_alpha_codeql() {
  local effective_rules=$1 alpha_id=$2
  jq -e --argjson id "$alpha_id" '
    type == "array" and any(.[]; .ruleset_id == $id and .type == "code_scanning" and
      any(.parameters.code_scanning_tools[]?; .tool == "CodeQL" and
        .alerts_threshold == "errors_and_warnings" and
        .security_alerts_threshold == "medium_or_higher"))
  ' <<< "$effective_rules" >/dev/null || die 'effective Alpha CodeQL requirement is missing or differs from the required native threshold'
}

require_effective_repo_scanners() {
  local effective_rules=$1 expected actual
  expected=$(jq -ce '[.rules[] | select(.type == "code_scanning") | .parameters.code_scanning_tools]
    | if length == 1 then .[0] | sort_by(.tool) else error("native scanner rule is ambiguous") end' \
    <<< "$repo_rule") || die 'native scanner rule cannot be compared'
  actual=$(jq -ce --argjson id "$REPO_SCAN_RULE_ID" '
    [.[] | select(.ruleset_id == $id and .type == "code_scanning") | .parameters.code_scanning_tools]
    | if length == 1 then .[0] | sort_by(.tool) else error("native scanner rule is absent") end' \
    <<< "$effective_rules") || die 'native scanner requirements are not effective on main'
  [[ "$(jq -S -c . <<< "$actual")" == "$(jq -S -c . <<< "$expected")" ]] \
    || die 'effective native scanner requirements differ from the repository rule'
}

readonly CANARY_CASES='[
  {"id":"docs-baseline-pass","protected":"pass"},
  {"id":"selector-mask-01","protected":"pass"},
  {"id":"selector-mask-02","protected":"pass"},
  {"id":"selector-mask-03","protected":"pass"},
  {"id":"selector-mask-04","protected":"pass"},
  {"id":"selector-mask-05","protected":"pass"},
  {"id":"selector-mask-06","protected":"pass"},
  {"id":"selector-mask-07","protected":"pass"},
  {"id":"selector-mask-08","protected":"pass"},
  {"id":"selector-mask-09","protected":"pass"},
  {"id":"selector-mask-10","protected":"pass"},
  {"id":"selector-mask-11","protected":"pass"},
  {"id":"selector-mask-12","protected":"pass"},
  {"id":"selector-mask-13","protected":"pass"},
  {"id":"selector-mask-14","protected":"pass"},
  {"id":"selector-mask-15","protected":"pass"},
  {"id":"selector-mask-16","protected":"pass"},
  {"id":"selector-mask-17","protected":"pass"},
  {"id":"selector-mask-18","protected":"pass"},
  {"id":"selector-mask-19","protected":"pass"},
  {"id":"selector-mask-20","protected":"pass"},
  {"id":"selector-mask-21","protected":"pass"},
  {"id":"selector-mask-22","protected":"pass"},
  {"id":"selector-mask-23","protected":"pass"},
  {"id":"selector-mask-24","protected":"pass"},
  {"id":"selector-mask-25","protected":"pass"},
  {"id":"selector-mask-26","protected":"pass"},
  {"id":"selector-mask-27","protected":"pass"},
  {"id":"selector-mask-28","protected":"pass"},
  {"id":"failed-build-blocked","protected":"blocked"}
]'

validate_evidence_shape() {
  local main_sha=$1
  jq -e --argjson repo "$REPO_ID" --arg main "$main_sha" --argjson protected_rule "$workflow_rule_id" \
    --argjson expected "$CANARY_CASES" --slurpfile current "${snapshot_dir}/open-pr-heads.json" '
      def valid_case($c; $e):
        (($c|keys|sort) == (["case_id","number","head_sha","protected_run_id","run_attempt","protected_observed"]|sort)) and
        $c.protected_observed == $e.protected and
        ($c.number|type)=="number" and $c.number > 0 and $c.number == ($c.number|floor) and
        ($c.head_sha|test("^[0-9a-f]{40}$")) and
        ($c.protected_run_id|type)=="number" and $c.protected_run_id > 0 and $c.protected_run_id == ($c.protected_run_id|floor) and
        ($c.run_attempt|type)=="number" and $c.run_attempt > 0 and $c.run_attempt == ($c.run_attempt|floor) and
        any($current[0][]; .number == $c.number and .head_sha == $c.head_sha);

      ((keys|sort) == (["schema_version","repository_id","main_sha","protected","open_pr_heads","canaries"]|sort)) and
      .schema_version == 3 and .repository_id == $repo and .main_sha == $main and
      (.protected | type == "object" and ((keys|sort) == (["ruleset_id","source_path","source_sha","mode","run_id","run_attempt","conclusion"]|sort)) and
        .ruleset_id == $protected_rule and .source_path == ".github/workflows/required-pr-build.yml" and
        .source_sha == $main and .mode == "required-full" and
        (.run_id|type)=="number" and .run_id > 0 and (.run_attempt|type)=="number" and .run_attempt > 0 and .conclusion == "success") and
      (.open_pr_heads | type == "array" and all(.[]; ((keys|sort) == (["number","head_sha","protected_run_id","run_attempt","check_sha","conclusion"]|sort)) and
        (.number|type)=="number" and (.head_sha|test("^[0-9a-f]{40}$")) and
        (.protected_run_id|type)=="number" and (.run_attempt|type)=="number" and
        (.check_sha|test("^[0-9a-f]{40}$")) and (.conclusion|IN("success","failure")))) and
      ([.open_pr_heads[] | {number,head_sha,protected_run_id,run_attempt,conclusion}] | sort_by(.number)) ==
        ([.canaries[] | {number,head_sha,protected_run_id,run_attempt,
          conclusion:(if .protected_observed == "pass" then "success" else "failure" end)}] | sort_by(.number)) and
      (.canaries | type == "array" and length == ($expected|length) and
        ([.[].case_id] | sort) == ([$expected[].id] | sort) and
        ([.[].number] | unique | length) == ($expected|length) and
        ([.[] | [.protected_run_id,.run_attempt]] | unique | length) == ($expected|length) and
        all(.[]; . as $c | ($expected[] | select(.id == $c.case_id)) as $e | valid_case($c; $e))) and
      (.protected as $p | any(.canaries[];
        .case_id == "docs-baseline-pass" and .protected_run_id == $p.run_id and .run_attempt == $p.run_attempt))
    ' "$canary_evidence" >/dev/null || die 'canary evidence is missing, stale, malformed, or has an unknown observation'
}

verify_workflow_run() {
  local run_id=$1 attempt=$2 expected_head=$3 expected_check=$4 expected_conclusion=$5 pr_number=$6 main_sha=$7
  local run pr comparison checks run_ref head_repo_id rule_updated_utc
  run=$(api "repos/${ORG}/${REPO}/actions/runs/${run_id}") || die 'cannot read required workflow run'
  pr=$(api "repos/${ORG}/${REPO}/pulls/${pr_number}") || die 'cannot read current PR head and merge SHA'
  head_repo_id=$(jq -er '.head.repo.id | select(type == "number" and . > 0)' <<< "$pr") || die 'cannot bind required workflow run to PR head repository'
  comparison=$(api "repos/${ORG}/${REPO}/compare/${main_sha}...$(jq -r '.base.sha' <<< "$pr")") || die 'cannot verify protected source ancestry'
  # GitHub ruleset times include milliseconds; require the run's next whole second or later.
  rule_updated_utc=$(jq -er '.updated_at | select(endswith("Z")) | sub("\\.[0-9]+Z$"; "Z")' <<< "$workflow_rule") \
    || die 'cannot parse UTC workflow rule update time'
  jq -e --argjson id "$run_id" --argjson attempt "$attempt" --argjson repo_id "$REPO_ID" --argjson head_repo_id "$head_repo_id" \
    --arg repo "$ORG/$REPO" --arg path "$WORKFLOW" --arg head "$expected_head" --arg pin "$PR_CI_SHA" --arg main "$main_sha" \
    --arg required_url "https://api.github.com/repos/${ORG}/${REPO}/actions/required_workflows/" \
    --arg rule_updated "$rule_updated_utc" \
    --arg conclusion "$expected_conclusion" --argjson pr "$pr_number" '
      .id == $id and .run_attempt == $attempt and
      (.workflow_id | type == "number" and . > 0 and . == floor) and
      .workflow_url == ($required_url + (.workflow_id | tostring)) and
      (.created_at | fromdateiso8601) > ($rule_updated | fromdateiso8601) and
      (.path == $path or .path == ($path + "@main") or .path == ($path + "@refs/heads/main") or
       .path == ($repo + "/" + $path + "@main") or .path == ($repo + "/" + $path + "@refs/heads/main")) and
      .event == "pull_request" and .head_sha == $head and .conclusion == $conclusion and
      .repository.full_name == $repo and
      any(.pull_requests[]?; .number == $pr and .head.sha == $head and
        .head.repo.id == $head_repo_id and .base.sha == $main and .base.ref == "main" and
        .base.repo.id == $repo_id) and
      ([.referenced_workflows[]? | select(.path == ($repo + "/.github/workflows/pr-ci.yml@" + $pin) and .sha == $pin)] | length) == 1
    ' <<< "$run" >/dev/null || die 'required workflow run source, PR head, attempt, or conclusion is not current'
  jq -e --argjson pr "$pr_number" --arg repo "$ORG/$REPO" --arg head "$expected_head" --arg check "$expected_check" --arg main "$main_sha" '
      .number == $pr and .head.ref != null and .head.sha == $head and
      .base.ref == "main" and .base.sha == $main and .base.repo.full_name == $repo and .merge_commit_sha == $check
    ' <<< "$pr" >/dev/null || die 'supplied head or check/merge SHA is stale'
  jq -e --arg main "$main_sha" '
      .base_commit.sha == $main and .merge_base_commit.sha == $main and .behind_by == 0 and
      ((.status == "identical" and .ahead_by == 0 and .total_commits == 0) or
       (.status == "ahead" and .ahead_by > 0 and .ahead_by == .total_commits))
    ' <<< "$comparison" >/dev/null || die 'protected workflow source is not an ancestor of the PR base'
  checks=$(api --paginate "repos/${ORG}/${REPO}/commits/${expected_head}/check-runs?filter=latest" --jq '.check_runs[]') \
    || die 'cannot verify required workflow check result'
  run_ref=$(printf '%s' "$checks" | jq -s --argjson id "$(jq -r '.check_suite_id' <<< "$run")" --arg head "$expected_head" --arg conclusion "$expected_conclusion" '
    [.[] | select(.name | endswith("Required PR build result")) | select(.head_sha == $head) |
      select(.check_suite.id == $id) | select(.conclusion == $conclusion)] | length
  ')
  [[ "$run_ref" == 1 ]] || die 'required workflow check does not match run and PR head'
}

verify_native_codeql() {
  local pr_number=$1 head_sha=$2 main_sha=$3 checks match_count
  [[ "$pr_number" =~ ^[1-9][0-9]*$ && "$head_sha" =~ ^[0-9a-f]{40}$ ]] \
    || die 'native CodeQL check binding is malformed'
  checks=$(api --paginate "repos/${ORG}/${REPO}/commits/${head_sha}/check-runs?filter=latest&per_page=100" \
    --jq '.check_runs[]') || die "cannot read latest native CodeQL check for PR #${pr_number}"
  match_count=$(printf '%s\n' "$checks" | jq -se --arg head "$head_sha" \
    --arg main "$main_sha" --argjson pr "$pr_number" --argjson repo "$REPO_ID" '
    [.[] | select(.name == "CodeQL" and .app.id == 57789 and
      .app.slug == "github-advanced-security" and .head_sha == $head and .status == "completed" and
      .conclusion == "success" and
      (.pull_requests | type == "array" and length == 1 and .[0].number == $pr and
        .[0].head.sha == $head and .[0].base.sha == $main and .[0].base.ref == "main" and
        .[0].base.repo.id == $repo))]
    | length
  ') || die "native CodeQL check is missing or stale for PR #${pr_number}"
  [[ "$match_count" == 1 ]] || die "native CodeQL check is missing, ambiguous, or stale for PR #${pr_number}"
}

verify_canary_files() {
  local case_id=$1 pr_number=$2 mask digits pr files actual expected_json file_status
  local -a expected=()
  case "$case_id" in
    docs-baseline-pass) expected=(reference-documents/ci/canaries/2026-10-11-required-workflow-added-pass.md); file_status=added ;;
    failed-build-blocked) expected=(client/admin/src/protectedBuildFailureCanary.ts); file_status=added ;;
    selector-mask-??)
      digits=${case_id##*-}
      [[ "$digits" =~ ^(0[1-9]|1[0-9]|2[0-8])$ ]] || die "unknown canary file mask: ${case_id}"
      mask=${digits#0}
      if [ "$((mask & 1))" -ne 0 ]; then expected+=(client/desktop/src/renderer/config.ts); fi
      if [ "$((mask & 2))" -ne 0 ]; then expected+=(services/control-plane/pkg/clientversion/version.go); fi
      if [ "$((mask & 4))" -ne 0 ]; then expected+=(services/media-plane/src/lib/activeSpeakerSet.ts); fi
      if [ "$((mask & 8))" -ne 0 ]; then expected+=(client/admin/src/formatMetric.ts); fi
      if [ "$((mask & 16))" -ne 0 ]; then expected+=(reference-documents/adr/0018-ci-workflow-orchestration.md); fi
      file_status=modified ;;
    *) die "unknown canary case: ${case_id}" ;;
  esac
  pr=$(api "repos/${ORG}/${REPO}/pulls/${pr_number}") || die "cannot read canary PR #${pr_number} file count"
  jq -e --argjson count "${#expected[@]}" --argjson repo "$REPO_ID" \
    '.head.repo.id == $repo and .changed_files == $count' <<< "$pr" >/dev/null \
    || die "canary ${case_id} must be same-repository with the expected file count"
  files=$(api --paginate "repos/${ORG}/${REPO}/pulls/${pr_number}/files?per_page=100" \
    | jq -se 'if length > 0 and all(.[]; type == "array") then add else error("unknown PR file page shape") end') \
    || die "cannot read complete canary ${case_id} file list"
  expected_json=$(jq -cn '$ARGS.positional | sort' --args "${expected[@]}")
  actual=$(jq -ce --arg status "$file_status" 'if all(.[]; .status == $status) then [.[].filename] | sort else error("wrong file status") end' <<< "$files") \
    || die "canary ${case_id} changed-file status differs"
  [[ "$actual" == "$expected_json" ]] || die "canary ${case_id} changed-file set differs"
}

verify_full_mode_inventory() {
  local run_id=$1 attempt=$2 outcome=${3:-pass} inventory
  inventory=$(api --paginate "repos/${ORG}/${REPO}/actions/runs/${run_id}/attempts/${attempt}/jobs?per_page=100" \
    | jq -se --argjson attempt "$attempt" '
        if length > 0 and all(.[]; type == "object" and (.jobs | type) == "array"
          and (.total_count | type) == "number") then
          [.[].jobs[]] as $jobs
          | if ($jobs | length) == .[0].total_count and
               all($jobs[]; .run_attempt == $attempt) then $jobs
            else error("incomplete current-attempt job inventory") end
        else error("unknown job inventory page shape") end
      ') || die 'cannot read complete full-mode job inventory'
  jq -e --arg outcome "$outcome" '
    def passed($name): any(.[]; .name == ("Protected scan enforcement / " + $name) and .conclusion == "success");
    def failed($name): any(.[]; .name == ("Protected scan enforcement / " + $name) and .conclusion == "failure");
    passed("detect-changes") and passed("report") and
    (if $outcome == "blocked" then
       failed("build / Admin Portal / Test + Coverage") and
       failed("build / Production-compose / Docker build (cache-cold)")
     else
       passed("sonar / SonarCloud") and passed("eslint / ESLint SARIF") and
       passed("semgrep / Semgrep SAST") and
       any(.[]; .name == "Protected scan enforcement / semgrep / Semgrep SAST" and
         any(.steps[]?; .name == "Run Semgrep (custom rules)" and .conclusion == "success") and
         any(.steps[]?; .name == "Run Semgrep (community rulesets)" and .conclusion == "success") and
         any(.steps[]?; .name == "Canary — mutable-action-ref detector is still live" and .conclusion == "success")) and
       passed("govulncheck / govulncheck (control-plane)") and
       passed("build / Desktop / Test + Coverage (shard 1)") and
       passed("build / Desktop / Test + Coverage (shard 2)") and
       passed("build / Control Plane / Test + Coverage (shard 1)") and
       passed("build / Control Plane / Test + Coverage (shard 2)") and
       passed("build / Media Plane / Test + Coverage") and
       passed("build / Admin Portal / Test + Coverage") and
       passed("build / Desktop / Merge Coverage") and
       passed("build / Control Plane / Merge Coverage") and
       any(.[]; .name == "Protected OSV dependency scan / protected-pr-scan" and .conclusion == "success")
     end)
  ' <<< "$inventory" >/dev/null || die 'canary run lacks expected full-mode scan and build jobs'
}

validate_evidence_runs() {
  local main_sha protected_run protected_pr protected_head protected_check protected_attempt item case_id verdict expected
  main_sha=$(jq -r '.sha' <<< "$main_commit")
  jq -e '.name == "CI_SCAN_RELEVANCE_MODE" and .value == "required-full"' <<< "$mode_variable" >/dev/null \
    || die 'live scan mode is not required-full'
  validate_evidence_shape "$main_sha"

  protected_run=$(jq -r '.protected.run_id' "$canary_evidence")
  protected_attempt=$(jq -r '.protected.run_attempt' "$canary_evidence")
  protected_head=$(jq -r --argjson run "$protected_run" --argjson attempt "$protected_attempt" \
    '.open_pr_heads[] | select(.protected_run_id == $run and .run_attempt == $attempt) | .head_sha' "$canary_evidence")
  protected_pr=$(jq -r --argjson run "$protected_run" --argjson attempt "$protected_attempt" \
    '.open_pr_heads[] | select(.protected_run_id == $run and .run_attempt == $attempt) | .number' "$canary_evidence")
  protected_check=$(jq -r --argjson run "$protected_run" --argjson attempt "$protected_attempt" \
    '.open_pr_heads[] | select(.protected_run_id == $run and .run_attempt == $attempt) | .check_sha' "$canary_evidence")
  [[ -n "$protected_head" && -n "$protected_pr" && -n "$protected_check" ]] \
    || die 'successful full reference run is not bound to a current open PR head'
  verify_workflow_run "$protected_run" "$protected_attempt" "$protected_head" "$protected_check" success "$protected_pr" "$main_sha"
  verify_native_codeql "$protected_pr" "$protected_head" "$main_sha"
  verify_full_mode_inventory "$protected_run" "$protected_attempt"

  while IFS= read -r item; do
    [[ -n "$item" ]] || continue
    case_id=$(jq -r '.case_id' <<< "$item")
    verdict=$(jq -r '.protected_observed' <<< "$item")
    expected=success; [[ "$verdict" == blocked ]] && expected=failure
    protected_pr=$(jq -r '.number' <<< "$item")
    protected_head=$(jq -r '.head_sha' <<< "$item")
    protected_check=$(jq -r --argjson pr "$protected_pr" '.open_pr_heads[] | select(.number == $pr) | .check_sha' "$canary_evidence")
    [[ -n "$protected_check" ]] || die "canary ${case_id} is not bound to a current checked PR head"
    verify_workflow_run "$(jq -r '.protected_run_id' <<< "$item")" "$(jq -r '.run_attempt' <<< "$item")" \
      "$protected_head" "$protected_check" "$expected" "$protected_pr" "$main_sha"
    verify_canary_files "$case_id" "$protected_pr"
    verify_native_codeql "$protected_pr" "$protected_head" "$main_sha"
    verify_full_mode_inventory "$(jq -r '.protected_run_id' <<< "$item")" "$(jq -r '.run_attempt' <<< "$item")" "$verdict"
  done < <(jq -c '.canaries[]' "$canary_evidence")
}

# Read back every mode update; an ambiguous PATCH outcome cannot be credited.
set_scan_mode() {
  local value=$1 body current
  current=$(api "repos/${ORG}/${REPO}/actions/variables/CI_SCAN_RELEVANCE_MODE") || return 1
  if [[ "$value" == required-relevant:* ]]; then
    [[ "$(printf '%s' "$current" | canonical)" == "$(cat "${snapshot_dir}/scan-mode-variable.json")" ]] || return 1
  else
    jq -e --arg token "$shadow_token" '.name == "CI_SCAN_RELEVANCE_MODE" and
      (.value == "required-full" or .value == $token)' <<< "$current" >/dev/null || return 1
  fi
  body=$(jq -cn --arg value "$value" '{name:"CI_SCAN_RELEVANCE_MODE",value:$value}')
  if ! api -X PATCH "repos/${ORG}/${REPO}/actions/variables/CI_SCAN_RELEVANCE_MODE" --input - <<< "$body" >/dev/null; then
    current=$(api "repos/${ORG}/${REPO}/actions/variables/CI_SCAN_RELEVANCE_MODE") || return 1
    [[ "$(jq -r '.value // empty' <<< "$current")" == "$value" ]] || return 1
    mode_variable=$current
    return 0
  fi
  current=$(api "repos/${ORG}/${REPO}/actions/variables/CI_SCAN_RELEVANCE_MODE") || return 1
  [[ "$(jq -r '.name // empty' <<< "$current")" == CI_SCAN_RELEVANCE_MODE &&
     "$(jq -r '.value // empty' <<< "$current")" == "$value" ]] || return 1
  mode_variable=$current
}

check_repo_scan_rule() {
  local expected_rule live_rule
  [[ -s "$NATIVE_SCAN_SPEC" ]] || die 'committed native scanner contract is unavailable'
  expected_rule=$(jq -ceS '{name,target,enforcement,conditions,bypass_actors,
    rules:(.rules | map(.parameters.code_scanning_tools |= sort_by(.tool)))}' "$NATIVE_SCAN_SPEC" 2>/dev/null) \
    || die 'committed native scanner contract is malformed'
  live_rule=$(jq -ceS '{name,target,enforcement,conditions,bypass_actors,
    rules:(.rules | map(.parameters.code_scanning_tools |= sort_by(.tool)))}' <<< "$repo_rule" 2>/dev/null) \
    || die 'live Alpha scanner ruleset changed or has no scanner requirements'
  jq -e '.id == 17541948' <<< "$repo_rule" >/dev/null \
    || die 'live Alpha scanner ruleset changed or has no scanner requirements'
  [[ "$live_rule" == "$expected_rule" ]] \
    || die 'live Alpha scanner ruleset changed or has no scanner requirements'
}

wait_for_attempt() {
  local id=$1 attempt=$2 run count
  for ((count=0; count<180; count++)); do
    run=$(api "repos/${ORG}/${REPO}/actions/runs/${id}") || return 1
    if jq -e --argjson attempt "$attempt" '.run_attempt == $attempt and .status == "completed"' <<< "$run" >/dev/null; then
      printf '%s\n' "$run"
      return 0
    fi
    jq -e --argjson attempt "$attempt" '.run_attempt <= $attempt' <<< "$run" >/dev/null || return 1
    sleep 10
  done
  return 1
}

rerun_and_wait() {
  local id=$1 current attempt
  current=$(api "repos/${ORG}/${REPO}/actions/runs/${id}") || return 1
  jq -e '.status == "completed" and (.run_attempt | type == "number")' <<< "$current" >/dev/null || return 1
  attempt=$(( $(jq -r '.run_attempt' <<< "$current") + 1 ))
  api -X POST "repos/${ORG}/${REPO}/actions/runs/${id}/rerun" >/dev/null || return 1
  wait_for_attempt "$id" "$attempt"
}

verify_mode_log() {
  local run=$1 expected_mode=$2 expected_conclusion=$3 pr_number head check attempt id jobs log line
  id=$(jq -r '.id' <<< "$run")
  attempt=$(jq -r '.run_attempt' <<< "$run")
  head=$(jq -r '.head_sha' <<< "$run")
  pr_number=$(jq -er '[.pull_requests[]?.number] | if length == 1 then .[0] else error("ambiguous PR") end' <<< "$run") || return 1
  local pr
  pr=$(api "repos/${ORG}/${REPO}/pulls/${pr_number}") || return 1
  check=$(jq -r '.merge_commit_sha // empty' <<< "$pr")
  jq -e --arg head "$head" --arg main "$(jq -r '.sha' <<< "$main_commit")" '
    .state == "open" and .head.sha == $head and .base.sha == $main and .base.ref == "main"
  ' <<< "$pr" >/dev/null || return 1
  verify_workflow_run "$id" "$attempt" "$head" "$check" "$expected_conclusion" "$pr_number" "$(jq -r '.sha' <<< "$main_commit")" || return 1
  jobs=$(api --paginate "repos/${ORG}/${REPO}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100" \
    | jq -se --argjson attempt "$attempt" '
        if length > 0 and all(.[]; type == "object" and (.jobs | type) == "array" and (.total_count | type) == "number") then
          [.[].jobs[]] as $jobs | if ($jobs | length) == .[0].total_count and
            all($jobs[]; .run_attempt == $attempt) then $jobs else error("incomplete jobs") end
        else error("unknown jobs") end
      ') || return 1
  local result_job
  result_job=$(jq -er --arg conclusion "$expected_conclusion" '
    [.[] | select(.name == "Required PR build result" and .status == "completed" and .conclusion == $conclusion)]
    | if length == 1 then .[0].id else error("missing result job") end
  ' <<< "$jobs") || return 1
  log=$(api --allow-escape-sequences "repos/${ORG}/${REPO}/actions/jobs/${result_job}/logs") || return 1
  line=$(printf '%s\n' "$log" | grep -F "policy=${PR_CI_SHA} head=${head} merge=${check} mode=${expected_mode} selected=" \
    | grep -F ' skipped=' | tail -n 1) || return 1
  if [[ "$expected_mode" == required-relevant ]]; then
    local selection skipped
    selection=${line#* selected=}
    skipped=${selection#* skipped=}
    selection=${selection%% skipped=*}
    [[ "$selection" == semgrep_community &&
       "$skipped" == 'codeql_actions, codeql_go, codeql_js, eslint, govulncheck, osv, semgrep_canary, semgrep_custom, sonar, sonar_admin, sonar_control_plane, sonar_desktop, sonar_force_all, sonar_media_plane' ]] || return 1
    jq -e '
      def idle($prefix): all(.[]; (.name | startswith($prefix) | not) or .conclusion == "skipped");
      any(.[]; .name == "Protected scan enforcement / semgrep / Semgrep SAST" and .conclusion == "success" and
        any(.steps[]?; .name == "Run Semgrep (community rulesets)" and .conclusion == "success") and
        any(.steps[]?; .name == "Run Semgrep (custom rules)" and .conclusion == "skipped") and
        any(.steps[]?; .name == "Canary — mutable-action-ref detector is still live" and .conclusion == "skipped")) and
      idle("Protected scan enforcement / eslint") and
      idle("Protected scan enforcement / govulncheck") and
      idle("Protected scan enforcement / sonar") and
      idle("Protected OSV dependency scan") and
      idle("Protected scan enforcement / build / Desktop / Test + Coverage") and
      idle("Protected scan enforcement / build / Control Plane / Test + Coverage") and
      idle("Protected scan enforcement / build / Media Plane / Test + Coverage") and
      idle("Protected scan enforcement / build / Admin Portal / Test + Coverage") and
      idle("Protected scan enforcement / build / Desktop / Merge Coverage") and
      idle("Protected scan enforcement / build / Control Plane / Merge Coverage")
    ' <<< "$jobs" >/dev/null || return 1
  fi
  printf 'VERIFIED: run %s attempt %s used %s for PR #%s (%s).\n' "$id" "$attempt" "$expected_mode" "$pr_number" "$expected_conclusion"
}

restore_shadow_trial() {
  local status=$? restored_run current attempt conclusion
  trap - EXIT INT TERM HUP
  [[ "$mode_change_attempted" == true ]] || exit "$status"
  set +e
  if ! set_scan_mode required-full; then
    echo 'CRITICAL: required-full mode could not be restored and read back' >&2
    exit 1
  fi
  echo 'RESTORED: CI_SCAN_RELEVANCE_MODE=required-full (read back).' >&2
  if ! current=$(api "repos/${ORG}/${REPO}/actions/runs/${run_id}"); then
    echo 'CRITICAL: cannot read trial run after restoring full mode' >&2
    exit 1
  fi
  attempt=$((reference_attempt + 1))
  # The rerun POST may have succeeded before its new attempt becomes visible.
  if ! current=$(wait_for_attempt "$run_id" "$attempt"); then
    current=$(api "repos/${ORG}/${REPO}/actions/runs/${run_id}") || exit 1
    jq -e --argjson reference "$reference_attempt" \
      '.run_attempt == $reference and .status == "completed"' <<< "$current" >/dev/null || {
        echo 'CRITICAL: trial attempt did not settle before full-mode replay' >&2
        exit 1
      }
  fi
  if ! restored_run=$(rerun_and_wait "$run_id"); then
    echo 'CRITICAL: trial run could not be replayed in full mode' >&2
    exit 1
  fi
  conclusion=$(jq -r '.conclusion // empty' <<< "$restored_run")
  if [[ "$conclusion" != success ]] || \
     ! verify_mode_log "$restored_run" required-full "$conclusion" ||
     ! verify_full_mode_inventory "$run_id" "$(jq -r '.run_attempt' <<< "$restored_run")"; then
    echo 'CRITICAL: full-mode replay of trial run was not verified' >&2
    exit 1
  fi
  if ! (
    read_live
    [[ "$(printf '%s' "$org_rule" | canonical)" == "$(cat "${snapshot_dir}/org-ruleset-17153062.json")" &&
       "$(printf '%s' "$repo_rule" | canonical)" == "$(cat "${snapshot_dir}/repo-ruleset-17541948.json")" &&
       "$(printf '%s' "$effective" | canonical)" == "$(cat "${snapshot_dir}/effective-branch-rules.json")" &&
       "$(printf '%s' "$workflow_rule" | canonical)" == "$(cat "${snapshot_dir}/workflow-ruleset.json")" &&
       "$(printf '%s' "$workflow_custody_rule" | canonical)" == "$(cat "${snapshot_dir}/org-workflow-custody-24555855.json")" &&
       "$(printf '%s' "$open_prs" | canonical)" == "$(cat "${snapshot_dir}/open-pr-heads.json")" &&
       "$(printf '%s' "$main_commit" | canonical)" == "$(cat "${snapshot_dir}/main-commit.json")" &&
       "$(printf '%s' "$workflow" | canonical)" == "$(cat "${snapshot_dir}/workflow-metadata.json")" ]] || exit 1
    jq -e '.name == "CI_SCAN_RELEVANCE_MODE" and .value == "required-full"' <<< "$mode_variable" >/dev/null || exit 1
    check_repo_scan_rule
    check_native_codeql_tuple
    require_effective_alpha_codeql "$effective" "$ORG_RULE_ID"
    require_effective_repo_scanners "$effective"
    verify_native_codeql "$shadow_pr_number" "$shadow_head_sha" "$(jq -r '.sha' <<< "$main_commit")"
  ); then
    echo 'CRITICAL: protected or native rules changed during the shadow trial' >&2
    exit 1
  fi
  exit "$status"
}

shadow_trial() {
  local case_count target_run current
  case_count=$(jq --argjson id "$run_id" '[.canaries[] | select(.protected_run_id == $id and .case_id == "docs-baseline-pass" and .protected_observed == "pass")] | length' "$canary_evidence")
  [[ "$case_count" == 1 ]] || die 'shadow run must be the successful docs-baseline-pass canary'
  reference_attempt=$(jq -r --argjson id "$run_id" '.canaries[] | select(.protected_run_id == $id) | .run_attempt' "$canary_evidence")
  shadow_pr_number=$(jq -r --argjson id "$run_id" '.canaries[] | select(.protected_run_id == $id) | .number' "$canary_evidence")
  shadow_head_sha=$(jq -r --argjson id "$run_id" '.canaries[] | select(.protected_run_id == $id) | .head_sha' "$canary_evidence")
  read_live
  load_reviewed
  validate_policy
  require_workflow_custody "$workflow_custody_rule"
  check_repo_scan_rule
  check_native_codeql_tuple
  require_effective_alpha_codeql "$effective" "$ORG_RULE_ID"
  require_effective_repo_scanners "$effective"
  current=$(api "repos/${ORG}/${REPO}/actions/runs/${run_id}") || die 'cannot recheck trial run before shadow lease'
  jq -e --argjson attempt "$reference_attempt" '.run_attempt == $attempt and .status == "completed"' <<< "$current" >/dev/null \
    || die 'trial run attempt changed since canary review'
  shadow_token="required-relevant:${run_id}:$((reference_attempt + 1)):$(($(date -u +%s) + 1800))"
  mode_change_attempted=false
  trap restore_shadow_trial EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  mode_change_attempted=true
  set_scan_mode "$shadow_token" || die 'scoped required-relevant mode update failed or was not verified'
  target_run=$(rerun_and_wait "$run_id") || die 'protected shadow rerun did not reach a completed new attempt'
  jq -e '.conclusion == "success"' <<< "$target_run" >/dev/null || die 'protected shadow rerun failed'
  verify_mode_log "$target_run" required-relevant success || die 'protected shadow rerun did not prove selective current-head execution'
  verify_native_codeql "$shadow_pr_number" "$shadow_head_sha" "$(jq -r '.sha' <<< "$main_commit")"
  echo 'OBSERVED: selective protected result passed; native scanner rules remain active.'
}

read_live
validate_policy
require_workflow_custody "$workflow_custody_rule"
check_repo_scan_rule
check_native_codeql_tuple
require_effective_alpha_codeql "$effective" "$ORG_RULE_ID"
require_effective_repo_scanners "$effective"
jq -e '.name == "CI_SCAN_RELEVANCE_MODE" and .value == "required-full"' <<< "$mode_variable" >/dev/null \
  || die 'live scan mode is not required-full'
if [[ "$mode" == --dry-run ]]; then
  write_snapshots
  echo '[dry-run] Read-only snapshots written to the snapshot directory.'
  echo '[dry-run] Review all snapshots and obtain 30 current-head full-mode canaries before --shadow-trial.'
  exit 0
fi

load_reviewed
validate_evidence_runs
shadow_trial
