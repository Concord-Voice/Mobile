import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateVerdict,
  inspectBytecode,
  extractVerdict,
  prefix,
  runCommand,
  nativeSelection,
  resolvedAndroidEngine,
  startLogCollector,
  sdkAdb,
  androidObserveFailure,
} from './run.mjs';

const expected = {
  schema: 1,
  nonce: 'a'.repeat(32),
  sourceHead: 'b'.repeat(40),
  platform: 'ios',
  rnVersion: '0.88.0',
  reactVersion: '19.3.1',
  ossVersion: '1.0.0',
  hbcVersion: 99,
};
const iosCases = [
  'layout',
  'nativeVersion',
  'hermesRuntime',
  'nativeAvailable',
  'identityRoundTrip',
  'channelRoundTrip',
  'tamperRefusal',
  'wrongPasswordRefusal',
  'wrongKindRefusal',
  'releasedHandleRefusal',
  'cleanup',
];
function verdict(platform = 'ios') {
  const names =
    platform === 'ios'
      ? iosCases
      : [
          'layout',
          'nativeVersion',
          'hermesRuntime',
          'nativeUnavailable',
          'missingModuleRefusal',
        ];
  return {
    schema: 1,
    nonce: expected.nonce,
    sourceHead: expected.sourceHead,
    platform,
    rnVersion: '0.88.0',
    reactVersion: '19.3.1',
    hermes: { ossVersion: '1.0.0', build: 'Release' },
    checks: Object.fromEntries(names.map(name => [name, true])),
    passed: true,
    failureCase: null,
  };
}
test('accepts complete iOS bridge execution and explicit Android absence evidence', () => {
  assert.deepEqual(validateVerdict(verdict(), expected), verdict());
  const android = verdict('android');
  assert.deepEqual(
    validateVerdict(android, { ...expected, platform: 'android' }),
    android,
  );
});
test('rejects stale nonce and wrong native or engine versions', () => {
  for (const change of [
    { nonce: 'c'.repeat(32) },
    { rnVersion: '0.87.1' },
    { hermes: { ossVersion: '0.99.0', build: 'Release' } },
    { hermes: { ossVersion: '1.0.0', build: 'Debug' } },
  ]) {
    assert.throws(() => validateVerdict({ ...verdict(), ...change }, expected));
  }
});
test('rejects missing, failed or extra cases and false success', () => {
  const absent = verdict();
  delete absent.checks.tamperRefusal;
  const extra = verdict();
  extra.checks.inventedCrypto = true;
  const failed = verdict();
  failed.checks.tamperRefusal = false;
  for (const value of [
    absent,
    extra,
    failed,
    { ...verdict(), passed: false },
  ]) {
    assert.throws(() => validateVerdict(value, expected));
  }
});
test('rejects unknown or secret-bearing fields without echoing their values', () => {
  const marker = 'synthetic-value-must-not-be-logged';
  for (const value of [
    { ...verdict(), plaintext: marker },
    { ...verdict(), hermes: { ...verdict().hermes, secret: marker } },
  ]) {
    assert.throws(
      () => validateVerdict(value, expected),
      error => !error.message.includes(marker),
    );
  }
});
test('requires actual Hermes bytecode magic and matching version', () => {
  const bytes = Buffer.alloc(12);
  bytes.writeBigUInt64LE(0x1f1903c103bc1fc6n);
  bytes.writeUInt32LE(99, 8);
  assert.equal(inspectBytecode(bytes, 99), 99);
  assert.throws(() => inspectBytecode(Buffer.from('plain JavaScript'), 99));
  assert.throws(() => inspectBytecode(bytes, 98));
  assert.throws(() => inspectBytecode(bytes.subarray(0, 8), 99));
});
test('ignores another PID and rejects duplicate or malformed native reports', () => {
  const message = prefix + JSON.stringify(verdict());
  const row = processID => JSON.stringify({ processID, eventMessage: message });
  assert.equal(extractVerdict(row(99), expected, 42), null);
  assert.deepEqual(extractVerdict(row(42), expected, 42), verdict());
  assert.throws(() => extractVerdict(row(42) + '\n' + row(42), expected, 42));
  assert.throws(() =>
    extractVerdict(
      JSON.stringify({ processID: 42, eventMessage: prefix + '{bad' }),
      expected,
      42,
    ),
  );
});
test('bounds real subprocesses and never propagates raw stderr', async () => {
  assert.equal(
    await runCommand(process.execPath, ['-e', 'process.stdout.write("ok")']),
    'ok',
  );
  assert.equal(
    await runCommand(
      process.execPath,
      ['-e', 'process.stdin.pipe(process.stdout)'],
      { input: 'no\n' },
    ),
    'no\n',
  );
  await assert.rejects(
    runCommand(process.execPath, [
      '-e',
      'process.stderr.write("must-not-escape");process.exit(2)',
    ]),
    error => error.message === 'platform-command-failed',
  );
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      timeout: 50,
    }),
    error => error.message === 'platform-command-failed',
  );
});

test('permits a failure-only private sanitizer without propagating raw subprocess output', async () => {
  let captured;
  await assert.rejects(
    runCommand(
      process.execPath,
      [
        '-e',
        'process.stdout.write("compiler diagnostic");process.stderr.write("synthetic-private-value");process.exit(2);',
      ],
      {
        onFailure: value => {
          captured = value;
        },
      },
    ),
    error => error.message === 'platform-command-failed',
  );
  assert.equal(captured.stdout, 'compiler diagnostic');
  assert.equal(captured.stderr, 'synthetic-private-value');
});

test('binds native dependency selections independently of the compiler package', () => {
  const lock =
    'PODS:\n  - hermes-engine (260318099.0.4):\n    - hermes-engine/Pre-built (= 260318099.0.4)\n';
  const properties = 'HERMES_VERSION_NAME=260318099.0.4\n';
  assert.equal(nativeSelection('ios', lock), '260318099.0.4');
  assert.equal(nativeSelection('android', properties), '260318099.0.4');
  assert.throws(() =>
    nativeSelection('ios', lock.replace('260318099.0.4', '250829098.0.17')),
  );
  assert.throws(() => nativeSelection('ios', 'PODS:\n'));
  assert.throws(() =>
    nativeSelection('android', 'HERMES_VERSION_NAME=unknown'),
  );
  const dependency =
    'com.facebook.hermes:hermes-android:260318099.0.4\n   Variant releaseRuntimeElements-published:\n';
  assert.equal(
    resolvedAndroidEngine(dependency, '260318099.0.4'),
    'com.facebook.hermes:hermes-android:260318099.0.4',
  );
  assert.throws(() => resolvedAndroidEngine(dependency, '250829098.0.17'));
  assert.throws(() =>
    resolvedAndroidEngine(
      dependency.replace('com.facebook.hermes', 'com.example'),
      '260318099.0.4',
    ),
  );
});

test('collects a real bounded live child stream and preserves PID and nonce filtering', async () => {
  const row = JSON.stringify({
    processID: 42,
    eventMessage: prefix + JSON.stringify(verdict()),
  });
  const code = `process.stdout.write(${JSON.stringify(
    row + '\n',
  )});setInterval(()=>{},1000);`;
  const collector = await startLogCollector(process.execPath, ['-e', code]);
  try {
    const deadline = Date.now() + 3000;
    while (!collector.read().includes(prefix) && Date.now() < deadline) {
      await new Promise(done => setTimeout(done, 10));
    }
    assert.deepEqual(extractVerdict(collector.read(), expected, 42), verdict());
    assert.equal(extractVerdict(collector.read(), expected, 99), null);
    assert.equal(
      extractVerdict(
        collector.read(),
        { ...expected, nonce: 'c'.repeat(32) },
        42,
      ),
      null,
    );
  } finally {
    await collector.stop();
  }
});

test('fails closed on collector exit and oversized output without leaking child stderr', async () => {
  for (const [code, failure] of [
    [
      'process.stderr.write("synthetic-must-not-escape");process.exit(2);',
      'native-log-collector-exited',
    ],
    [
      'process.stdout.write(Buffer.alloc(4*1024*1024+65536,120));setInterval(()=>{},1000);',
      'native-log-limit',
    ],
  ]) {
    const collector = await startLogCollector(process.execPath, ['-e', code]);
    const deadline = Date.now() + 3000;
    let caught;
    while (Date.now() < deadline) {
      try {
        collector.read();
      } catch (error) {
        caught = error;
        break;
      }
      await new Promise(done => setTimeout(done, 10));
    }
    assert.equal(caught?.message, failure);
    await assert.rejects(collector.stop(), error => error.message === failure);
  }
});

test('resolves adb from the SDK and refuses without ANDROID_HOME', () => {
  assert.equal(
    sdkAdb({ ANDROID_HOME: '/sdk' }),
    '/sdk/platform-tools/adb',
  );
  assert.throws(() => sdkAdb({}), /android-sdk-unavailable/);
});

test('reports only a sanitized category for a failed adb step', () => {
  assert.deepEqual(
    androidObserveFailure(
      'install',
      'Performing Install\nFailure [INSTALL_FAILED_INSUFFICIENT_STORAGE: /data/secret]',
    ),
    {
      androidObserveFailure: {
        step: 'install',
        category: 'INSTALL_FAILED_INSUFFICIENT_STORAGE',
        emptyOutput: false,
      },
    },
  );
  assert.equal(
    androidObserveFailure('launch', 'adb: device offline').androidObserveFailure
      .category,
    'device-unavailable',
  );
  assert.equal(
    androidObserveFailure(
      'launch',
      'Error: Activity class {com.x/com.x.Main} does not exist.',
    ).androidObserveFailure.category,
    'activity-missing',
  );
  assert.equal(
    androidObserveFailure('install', 'adb: failed to install x.apk: Failure [DELETE_FAILED_INTERNAL_ERROR]')
      .androidObserveFailure.category,
    'DELETE_FAILED_INTERNAL_ERROR',
  );
  assert.equal(
    androidObserveFailure('install', 'cmd: Failure calling service package: Broken pipe (32)')
      .androidObserveFailure.category,
    'adb-transport',
  );
  assert.equal(
    androidObserveFailure('install', '\n').androidObserveFailure.emptyOutput,
    true,
  );
  assert.deepEqual(
    androidObserveFailure(
      'install',
      'Performing Streamed Install\nadb: failed to copy /tmp/run-7f3a/app.apk: Read-only file system abc123DEF',
    ).androidObserveFailure.words,
    ['adb', 'failed', 'to', 'copy', 'file', 'system'],
  );
  assert.deepEqual(
    androidObserveFailure(
      'install',
      'Exception occurred while executing \'install\':\njava.lang.IllegalStateException: secret-123\n\tat com.android.server.pm.Foo.bar(Foo.java:12)',
    ).androidObserveFailure,
    {
      step: 'install',
      category: 'package-service-exception',
      exception: 'java.lang.IllegalStateException',
      emptyOutput: false,
    },
  );
  const other = androidObserveFailure('launch', 'token=abc123 secret path');
  assert.equal(other.androidObserveFailure.category, 'command-failed');
  assert.ok(!JSON.stringify(other).includes('abc123'));
});
