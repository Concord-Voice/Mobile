#!/usr/bin/env bash
# Self-test for sync-native-version.mjs against a throwaway fixture.
set -euo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync-native-version.mjs"
dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
mkdir -p "$dir/android/app" "$dir/ios/ConcordVoice.xcodeproj"
printf '{ "version": "0.2.0" }\n' > "$dir/package.json"
printf '        versionName "0.1.0"\n' > "$dir/android/app/build.gradle"
printf 'MARKETING_VERSION = 0.1.0;\nMARKETING_VERSION = 0.1.0;\n' > "$dir/ios/ConcordVoice.xcodeproj/project.pbxproj"
fail=0
if node "$SCRIPT" --check "$dir" 2>/dev/null; then echo "FAIL: --check passed on drift"; fail=1; fi
node "$SCRIPT" "$dir" >/dev/null
grep -q 'versionName "0.2.0"' "$dir/android/app/build.gradle" || { echo "FAIL: Gradle not synced"; fail=1; }
[[ $(grep -c 'MARKETING_VERSION = 0.2.0;' "$dir/ios/ConcordVoice.xcodeproj/project.pbxproj") == 2 ]] || { echo "FAIL: Xcode not synced"; fail=1; }
node "$SCRIPT" --check "$dir" || { echo "FAIL: --check failed after sync"; fail=1; }
printf '{ "version": "1.0" }\n' > "$dir/package.json"
if node "$SCRIPT" --check "$dir" 2>/dev/null; then echo "FAIL: accepted a non-X.Y.Z version"; fail=1; fi
[[ $fail == 0 ]] && echo "sync-native-version: all checks passed"
exit "$fail"
