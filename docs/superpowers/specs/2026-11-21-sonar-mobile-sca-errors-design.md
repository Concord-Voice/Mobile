# Mobile Sonar dependency analysis warnings — Design

Issueless ad-hoc lifecycle, 2026-11-21.

SonarCloud reports disabled resolution for `.github/requirements-pyyaml.txt`, `android/build.gradle`, and `native/ConcordCrypto/android/build.gradle`. The scanner job holds `SONAR_TOKEN`, so running Pip or Gradle build logic there is unsafe. The Android app already commits `android/app/gradle.lockfile` with its release runtime dependency versions. The native module also pins a test-only JUnit version outside that runtime lock.

On trusted main scans, generate a CycloneDX SBOM from the Android release runtime lock, the native module's explicit dependency pins, and the CI PyYAML pin without executing build tools. Exclude exactly the three warning-producing manifests from ordinary SCA resolution and import the SBOM. Keep `sonar.sca.gradleNoResolve=true`, `sonar.sca.pythonNoResolve=true`, and protected PR `sonar.sca.enabled=false`.

This covers the locked runtime and explicit native test pin. Root Gradle build plugins lack committed version pins and remain outside this SBOM. Dependabot watches both Gradle directories but cannot infer a version from an unversioned declaration alone. CocoaPods remains outside Sonar's supported ecosystems.

Acceptance: a main-branch scan reports none of the three skipped-resolution warnings and lists the SBOM packages; protected PR analysis still cannot execute PR-controlled build scripts.
