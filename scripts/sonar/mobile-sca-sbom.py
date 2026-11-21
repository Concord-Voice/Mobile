#!/usr/bin/env python3
"""Export locked Android runtime and CI pins for Sonar without running build tools."""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
GRADLE_PIN = re.compile(r"^([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)=releaseRuntimeClasspath$")
NATIVE_DEP = re.compile(r'^\s*(?:implementation|testImplementation)\("([A-Za-z0-9_.:-]+)"\)')
NATIVE_CALL = re.compile(r"^\s*(?:implementation|[A-Za-z]*Implementation|api|compileOnly|runtimeOnly)\b")
PIP_PIN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9_.-]*)==([^;\s\\]+)\s*\\$")
PIP_HASH = re.compile(r"^\s+--hash=sha256:[0-9a-f]{64}\s*\\?$")


def components():
    # shortcut: root build plugins have no locked versions; add a no-secret Gradle graph export when their versions must be scanned.
    maven = {}
    for line in (ROOT / "android/app/gradle.lockfile").read_text().splitlines():
        if line.startswith("#") or line == "empty=":
            continue
        match = GRADLE_PIN.fullmatch(line)
        if not match:
            raise ValueError(f"unsupported Gradle lock entry: {line}")
        group, artifact, version = match.groups()
        key = (group, artifact)
        if key in maven and maven[key] != version:
            raise ValueError(f"conflicting Gradle lock entry: {group}:{artifact}")
        maven[key] = version
    if not maven:
        raise ValueError("empty Android release runtime lock")

    for line in (ROOT / "native/ConcordCrypto/android/build.gradle").read_text().splitlines():
        if not NATIVE_CALL.match(line):
            continue
        match = NATIVE_DEP.match(line)
        if not match:
            raise ValueError(f"unsupported native Gradle dependency: {line}")
        parts = match[1].split(":")
        if len(parts) == 2:
            if tuple(parts) not in maven:
                raise ValueError(f"unlocked native Gradle dependency: {match[1]}")
        elif len(parts) == 3:
            key = tuple(parts[:2])
            if key in maven and maven[key] != parts[2]:
                raise ValueError(f"conflicting native Gradle dependency: {match[1]}")
            maven[key] = parts[2]
        else:
            raise ValueError(f"unsupported native Gradle dependency: {match[1]}")

    pip = None
    for line in (ROOT / ".github/requirements-pyyaml.txt").read_text().splitlines():
        if not line or line.startswith("#") or PIP_HASH.fullmatch(line):
            continue
        match = PIP_PIN.fullmatch(line)
        if not match or pip:
            raise ValueError(f"unsupported CI Pip pin: {line}")
        name = re.sub(r"[-_.]+", "-", match[1]).lower()
        pip = dict(type="library", name=name, version=match[2],
                   purl=f"pkg:pypi/{name}@{match[2]}")
    if not pip:
        raise ValueError("empty CI Pip manifest")

    return [dict(type="library", name=artifact, group=group, version=version,
                 purl=f"pkg:maven/{group}/{artifact}@{version}")
            for (group, artifact), version in sorted(maven.items())] + [pip]


if __name__ == "__main__":
    (ROOT / "sonar-mobile-deps.cdx.json").write_text(json.dumps(dict(
        bomFormat="CycloneDX", specVersion="1.5", version=1, components=components()
    ), indent=2) + "\n")
