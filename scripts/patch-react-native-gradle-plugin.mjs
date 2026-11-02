import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// RN 0.88.0's included build selects Kotlin 2.2, which cannot read Gradle
// 9.8.2's embedded Kotlin metadata. Keep the security-fixed Gradle distribution
// and narrowly align the compiler. Reassess/remove this on every RN upgrade.
const originalCatalogHash =
  'c7a028cdee90f490de9493ca9de92b61b994844836161871091c340c568f109e';
const patchedCatalogHash =
  '44a27d41062a7c01889fac1bc7666f8235ee14060de8588d66660830f8484c7d';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function readInput(path, json = false) {
  try {
    const bytes = await readFile(path);
    return json ? JSON.parse(bytes.toString('utf8')) : bytes;
  } catch {
    throw new Error('react-native-gradle-patch-input-unavailable');
  }
}

export async function patchReactNativeGradlePlugin(projectRoot) {
  const modules = join(projectRoot, 'node_modules');
  const plugin = join(modules, '@react-native/gradle-plugin');
  const [reactNative, gradlePlugin] = await Promise.all([
    readInput(join(modules, 'react-native/package.json'), true),
    readInput(join(plugin, 'package.json'), true),
  ]);
  if (
    reactNative?.name !== 'react-native' ||
    reactNative?.version !== '0.88.0'
  ) {
    throw new Error('unsupported-react-native-package');
  }
  if (
    gradlePlugin?.name !== '@react-native/gradle-plugin' ||
    gradlePlugin?.version !== '0.88.0'
  ) {
    throw new Error('unsupported-react-native-gradle-plugin-package');
  }

  const catalogPath = join(plugin, 'gradle/libs.versions.toml');
  const original = await readInput(catalogPath);
  const originalHash = digest(original);
  if (originalHash === patchedCatalogHash) return 'already-patched';
  if (originalHash !== originalCatalogHash) {
    throw new Error('unsupported-react-native-gradle-catalog');
  }

  const patched = Buffer.from(
    original.toString('utf8').replace('kotlin = "2.2.0"', 'kotlin = "2.4.21"'),
  );
  if (digest(patched) !== patchedCatalogHash) {
    throw new Error('unsupported-react-native-gradle-catalog');
  }
  await writeFile(catalogPath, patched);
  return 'patched';
}

function isDirectEntry() {
  if (!process.argv[1]) return false;
  const modulePath = fileURLToPath(import.meta.url);
  const entryPath = resolve(process.argv[1]);
  if (entryPath === modulePath) return true;
  let canonicalEntry;
  try {
    canonicalEntry = realpathSync(entryPath);
  } catch (error) {
    // Eval imports may supply an unrelated path as argv[1] without creating it.
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
  return canonicalEntry === realpathSync(modulePath);
}

if (isDirectEntry()) {
  try {
    if (process.argv.length !== 2) throw new Error('unexpected-arguments');
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    console.log(await patchReactNativeGradlePlugin(projectRoot));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
