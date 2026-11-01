import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const fixtureURL = new URL('./fixtures/gradle-distribution-metadata.json', import.meta.url);

class MissingMetadataEvidence extends Error {}

function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value)) {
    throw new MissingMetadataEvidence('Expected a stable compiler/metadata version');
  }
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new MissingMetadataEvidence('Invalid version components');
  return parts;
}

/**
 * Independent compatibility oracle from Kotlin v2.2.0 MetadataVersion.kt:
 * isCompatibleInternal rejects metadata 0.* and 1.0; for non-strict metadata,
 * the reader ceiling is INSTANCE.next(), otherwise INSTANCE. Major/minor are
 * compared, not patch. This permissive ceiling does not pretend CI diagnostic
 * text established any class-header strict-version flag.
 * https://github.com/JetBrains/kotlin/blob/v2.2.0/core/metadata/src/org/jetbrains/kotlin/metadata/deserialization/MetadataVersion.kt
 */
function canReadMetadata(compiler, metadata, strict = false) {
  const [major, minor] = versionParts(compiler);
  const [dataMajor, dataMinor] = versionParts(metadata);
  if (dataMajor === 0 || (dataMajor === 1 && dataMinor === 0)) return false;
  const [limitMajor, limitMinor] = strict
    ? [major, minor]
    : major === 1 && minor === 9 ? [2, 0] : [major, minor + 1];
  return dataMajor < limitMajor || (dataMajor === limitMajor && dataMinor <= limitMinor);
}

function selectedDistribution(properties) {
  const matches = [...properties.matchAll(/^distributionUrl=(.+)$/gm)];
  if (matches.length !== 1) throw new MissingMetadataEvidence('Expected one selected wrapper distribution');
  const url = matches[0][1].replace(/\\:/g, ':');
  if (!/^https:\/\/services\.gradle\.org\/distributions\/gradle-[0-9]+\.[0-9]+(?:\.[0-9]+)?-bin\.zip$/.test(url)) {
    throw new MissingMetadataEvidence('Unsupported wrapper distribution provenance');
  }
  return url;
}

// Parse only the selected catalog's simple string/inline-table declarations.
// An unknown catalog shape fails explicitly instead of assuming a compiler.
function catalogTable(source, name) {
  const sections = source.split(/^\[([^\]]+)\]\s*$/m);
  const matches = [];
  for (let i = 1; i < sections.length; i += 2) {
    if (sections[i] === name) matches.push(sections[i + 1]);
  }
  if (matches.length !== 1) throw new MissingMetadataEvidence(`Missing/duplicate catalog table: ${name}`);
  return matches[0];
}
function catalogAssignment(source, table, key) {
  const lines = catalogTable(source, table).split('\n')
    .filter(line => line.trim() && !line.trimStart().startsWith('#'));
  const matches = lines.filter(line => line.split('=')[0].trim() === key);
  if (matches.length !== 1) throw new MissingMetadataEvidence(`Missing/duplicate catalog selection: ${key}`);
  return matches[0].slice(matches[0].indexOf('=') + 1).trim();
}
function catalogCompiler(source, table, key, coordinateKey, coordinate) {
  const selected = catalogAssignment(source, table, key);
  if (!selected.startsWith('{') || !selected.endsWith('}')) {
    throw new MissingMetadataEvidence('Unknown Kotlin catalog coordinate');
  }
  const fields = new Map();
  for (const field of selected.slice(1, -1).split(',')) {
    const match = /^\s*([a-z][a-z0-9_.-]*)\s*=\s*"([^"\n]*)"\s*$/.exec(field);
    if (!match || fields.has(match[1])) throw new MissingMetadataEvidence('Unknown Kotlin inline table');
    fields.set(match[1], match[2]);
  }
  if (fields.get(coordinateKey) !== coordinate || !/^[A-Za-z0-9_-]+$/.test(fields.get('version.ref') ?? '')) {
    throw new MissingMetadataEvidence('Unknown Kotlin catalog version reference');
  }
  const version = catalogAssignment(source, 'versions', fields.get('version.ref'));
  const match = /^"([0-9]+\.[0-9]+\.[0-9]+)"$/.exec(version);
  if (!match) throw new MissingMetadataEvidence('Unknown Kotlin catalog compiler version');
  versionParts(match[1]);
  return match[1];
}

function metadataForDistribution(distributionURL, fixture) {
  if (fixture?.schemaVersion !== 1 || fixture?.distribution?.url !== distributionURL ||
      fixture?.evidence?.kind !== 'ci-module-metadata-diagnostic' ||
      fixture?.evidence?.strictHeaderFlagObserved !== false ||
      !/^https:\/\/services\.gradle\.org\/distributions\/gradle-[0-9.]+-bin\.zip\.sha256$/.test(fixture?.distribution?.checksumSource ?? '') ||
      fixture.distribution.checksumSource !== `${distributionURL}.sha256` ||
      !/^https:\/\/github\.com\/Concord-Voice\/Mobile\/actions\//.test(fixture?.evidence?.jobURL ?? '')) {
    throw new MissingMetadataEvidence('Missing provenance-bound metadata for selected distribution');
  }
  const modules = fixture.evidence.modules;
  if (!Array.isArray(modules) || modules.length !== 2 ||
      !modules.some(module => module?.coordinate === 'org.jetbrains.kotlin:kotlin-stdlib:2.4.10') ||
      !modules.some(module => module?.coordinate === 'org.jetbrains.kotlin:kotlin-reflect:2.4.10')) {
    throw new MissingMetadataEvidence('Missing observed embedded Kotlin modules');
  }
  for (const module of modules) versionParts(module?.metadataVersion);
  return modules;
}

const fixture = JSON.parse(readFileSync(fixtureURL, 'utf8'));

test('selected React Native Kotlin compilers can read selected wrapper embedded metadata', () => {
  const distribution = selectedDistribution(readFileSync(new URL('android/gradle/wrapper/gradle-wrapper.properties', root), 'utf8'));
  const catalog = readFileSync(new URL('node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml', root), 'utf8');
  const compilers = [
    ['settings/shared kotlin-jvm alias', catalogCompiler(catalog, 'plugins', 'kotlin-jvm', 'id', 'org.jetbrains.kotlin.jvm')],
    ['Kotlin Gradle plugin library', catalogCompiler(catalog, 'libraries', 'kotlin-gradle-plugin', 'module', 'org.jetbrains.kotlin:kotlin-gradle-plugin')],
  ];
  for (const [selection, compiler] of compilers) {
    for (const module of metadataForDistribution(distribution, fixture)) {
      assert.equal(canReadMetadata(compiler, module.metadataVersion), true,
        `${selection} compiler ${compiler} cannot read ${module.coordinate} metadata ${module.metadataVersion}, even under the non-strict ceiling`);
    }
  }
});

test('compatibility oracle includes equal/lower/next-minor and strictness controls', () => {
  for (const [compiler, metadata, strict, compatible] of [
    ['2.2.0', '2.4.0', false, false],
    ['2.3.0', '2.4.0', false, true],
    ['2.4.0', '2.4.0', false, true],
    ['2.4.0', '2.3.0', false, true],
    ['2.4.0', '2.4.0', true, true],
    ['2.3.0', '2.4.0', true, false],
    ['2.2.99', '2.4.0', false, false],
    ['2.3.99', '2.4.99', false, true],
    ['2.4.99', '2.4.0', true, true],
    ['2.4.0', '0.9.0', false, false],
    ['2.4.0', '1.0.0', false, false],
  ]) assert.equal(canReadMetadata(compiler, metadata, strict), compatible,
    `compiler=${compiler}, metadata=${metadata}, strict=${strict}`);
});

test('unknown/malformed distribution evidence refuses distinctly from incompatibility', () => {
  assert.equal(metadataForDistribution(fixture.distribution.url, fixture).length, 2);
  assert.throws(() => metadataForDistribution('https://services.gradle.org/distributions/gradle-99.0-bin.zip', fixture), MissingMetadataEvidence);
  for (const change of [
    value => { value.evidence.kind = 'unverified-assumption'; },
    value => { value.evidence.jobURL = 'https://example.test/unknown'; },
    value => { value.evidence.strictHeaderFlagObserved = true; },
    value => { value.distribution.checksumSource = 'https://example.test/checksum'; },
    value => { value.evidence.modules = []; },
    value => { value.evidence.modules = [null, null]; },
    value => { value.evidence.modules[0].metadataVersion = '2.4'; },
  ]) {
    const changed = structuredClone(fixture);
    change(changed);
    assert.throws(() => metadataForDistribution(fixture.distribution.url, changed), MissingMetadataEvidence);
  }
});

test('compiler is resolved through each actual alias rather than a preferred version key', () => {
  const source = `[versions]\nreader = "2.3.7"\nignored = "2.2.0"\n[plugins]\nkotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "reader" }\n[libraries]\nkotlin-gradle-plugin = { module = "org.jetbrains.kotlin:kotlin-gradle-plugin", version.ref = "reader" }\n`;
  assert.equal(catalogCompiler(source, 'plugins', 'kotlin-jvm', 'id', 'org.jetbrains.kotlin.jvm'), '2.3.7');
  assert.equal(catalogCompiler(source, 'libraries', 'kotlin-gradle-plugin', 'module', 'org.jetbrains.kotlin:kotlin-gradle-plugin'), '2.3.7');
  assert.throws(() => catalogCompiler(source.replace('version.ref = "reader"', 'version.ref = "unknown"'), 'plugins', 'kotlin-jvm', 'id', 'org.jetbrains.kotlin.jvm'), MissingMetadataEvidence);
});
