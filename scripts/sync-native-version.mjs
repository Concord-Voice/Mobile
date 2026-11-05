#!/usr/bin/env node
// Copies the root package.json version into the native app versions, so the
// app has one version source: the Gradle versionName (Android) and every
// MARKETING_VERSION in the Xcode project (iOS). The server's minimum-version
// gates (CLIENT_MIN_VERSION_IOS / _ANDROID) compare against these native values.
//
// usage: node scripts/sync-native-version.mjs [--check] [repo-root]
//   --check  change nothing; exit 1 when a native version differs.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const root = args.find((a) => a !== '--check') ?? process.cwd();

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error(`package.json version must be X.Y.Z, got: ${version}`);
  process.exit(1);
}

const targets = [
  ['android/app/build.gradle', /(versionName\s+")([^"]*)(")/g],
  ['ios/ConcordVoice.xcodeproj/project.pbxproj', /(MARKETING_VERSION = )([^;]*)(;)/g],
];

let drift = false;
for (const [rel, pattern] of targets) {
  const path = join(root, rel);
  const text = readFileSync(path, 'utf8');
  const found = [...text.matchAll(pattern)].map((m) => m[2]);
  if (found.length === 0) {
    console.error(`${rel}: no version field found`);
    process.exit(1);
  }
  const stale = found.filter((v) => v !== version);
  if (stale.length === 0) continue;
  if (check) {
    console.error(`${rel}: ${[...new Set(stale)].join(', ')} differs from package.json ${version}`);
    drift = true;
  } else {
    writeFileSync(path, text.replace(pattern, `$1${version}$3`));
    console.log(`${rel}: set to ${version}`);
  }
}
process.exit(drift ? 1 : 0);
