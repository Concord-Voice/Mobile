import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseSimulator,
  nativeTestSummary,
  verifyAndroidImage,
  nativeTestFailure,
  inspectEmulatorTool,
  assertEmulatorIdentity,
  chooseAcceleration,
  startEmulator,
  guestAvdName,
} from './devices.mjs';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from './run.mjs';

test('selects a compatible iPhone and latest installed iOS without borrowing a device', () => {
  const runtimes = {
    runtimes: [
      {
        identifier: 'old',
        version: '18.5.1',
        isAvailable: true,
        name: 'iOS 18.5.1',
      },
      {
        identifier: 'new',
        version: '26.1',
        isAvailable: true,
        name: 'iOS 26.1',
      },
      {
        identifier: 'beta',
        version: '27.0',
        isAvailable: false,
        name: 'iOS 27.0',
      },
    ],
  };
  const types = {
    devicetypes: [
      { identifier: 'ipad', name: 'iPad' },
      {
        identifier: 'future-phone',
        name: 'iPhone future',
        minRuntimeVersion: 27 * 65536,
      },
      {
        identifier: 'retired-phone',
        name: 'iPhone old',
        maxRuntimeVersion: 18 * 65536,
      },
      { identifier: 'phone', name: 'iPhone 17', minRuntimeVersion: 26 * 65536 },
    ],
  };
  assert.deepEqual(chooseSimulator(runtimes, types), {
    runtime: 'new',
    deviceType: 'phone',
    osVersion: '26.1',
  });
  assert.throws(() => chooseSimulator({ runtimes: [] }, types));
  assert.throws(() => chooseSimulator(runtimes, { devicetypes: [] }));
  assert.throws(() =>
    chooseSimulator(runtimes, {
      devicetypes: [types.devicetypes[1], types.devicetypes[2]],
    }),
  );
});

test('retains only fixed XCTest failure categories and known test IDs, never raw values', () => {
  const marker = 'synthetic-sensitive-comparand';
  const compile = `module 'ConcordCrypto' was not compiled for testing\n${marker}`;
  const evidence = nativeTestFailure(compile);
  assert.equal(evidence.status, 'BROKEN');
  assert.equal(evidence.category, 'module-not-compiled-for-testing');
  assert.equal(evidence.notRun.length, 15);
  assert.equal(JSON.stringify(evidence).includes(marker), false);
  const failed = nativeTestFailure(
    `Test Case '-[ConcordCrypto_Tests.ConcordCryptoTests testCreateIdentityUnlocksWithItsOwnPasswordOnly]' failed (0.1 seconds).\n${marker}`,
  );
  assert.deepEqual(failed.failed, [
    'testCreateIdentityUnlocksWithItsOwnPasswordOnly',
  ]);
  assert.equal(failed.category, 'native-test-failure');
  assert.equal(JSON.stringify(failed).includes(marker), false);
  assert.equal(
    nativeTestFailure(`dlopen failed: ${marker}`).category,
    'native-test-loader',
  );
  assert.equal(
    nativeTestFailure(marker).category,
    'native-test-command-unknown',
  );
});

test('retains only owned compiler locations and fixed reasons without raw diagnostics', () => {
  const hidden = 'synthetic-sensitive-comparand';
  const diagnostics = [
    `/private/${hidden}/native/ConcordCrypto/Tests/ConcordCryptoTests.swift:144:27: error: cannot find '${hidden}' in scope`,
    `/private/${hidden}/native/ConcordCrypto/Sources/ConcordCrypto.swift:39:5: error: cannot convert value of type '${hidden}'`,
    `/private/${hidden}/native/ConcordCrypto/Tests/ConcordCryptoTests.swift:145:2: error: unrecognized ${hidden}`,
    `/private/${hidden}/${hidden}.swift:12:3: error: arbitrary ${hidden}`,
    `/private/${hidden}/PretendConcordCryptoTests.swift:2:3: error: cannot find '${hidden}' in scope`,
    `/external/ConcordCryptoTests.swift:144:27: error: cannot find '${hidden}' in scope`,
    `/private/${hidden}/native/ConcordCrypto/Tests/ConcordCryptoTests.swift:0:3: error: ${hidden}`,
    `/private/${hidden}/native/ConcordCrypto/Tests/ConcordCryptoTests.swift:9999999999:3: error: ${hidden}`,
  ].join('\n');
  const evidence = nativeTestFailure(diagnostics);
  assert.equal(evidence.status, 'BROKEN');
  assert.equal(evidence.category, 'native-test-compilation');
  assert.ok(
    evidence.compilerDiagnostics,
    'compiler failure must retain bounded owned source locations',
  );
  assert.deepEqual(evidence.compilerDiagnostics.sites, [
    {
      file: 'ConcordCryptoTests.swift',
      line: 144,
      column: 27,
      reason: 'unknown-symbol',
    },
    {
      file: 'ConcordCrypto.swift',
      line: 39,
      column: 5,
      reason: 'type-conversion',
    },
    {
      file: 'ConcordCryptoTests.swift',
      line: 145,
      column: 2,
      reason: 'UNKNOWN',
    },
  ]);
  assert.equal(evidence.compilerDiagnostics.otherSourceErrors, true);
  assert.equal(evidence.compilerDiagnostics.siteLimitReached, false);
  assert.equal(JSON.stringify(evidence).includes(hidden), false);
  assert.equal(JSON.stringify(evidence).includes('/private/'), false);
  const bounded = nativeTestFailure(
    Array.from(
      { length: 20 },
      (_, n) =>
        `native/ConcordCrypto/Tests/ConcordCryptoTests.swift:${
          n + 1
        }:1: error: ${hidden}`,
    ).join('\n'),
  );
  assert.equal(bounded.compilerDiagnostics.sites.length, 8);
  assert.equal(bounded.compilerDiagnostics.siteLimitReached, true);
  for (const [message, reason] of [
    ["cannot find 'synthetic' in scope", 'unknown-symbol'],
    ["type 'Synthetic' has no member 'synthetic'", 'missing-member'],
    ["cannot convert value of type 'Synthetic'", 'type-conversion'],
    ["missing argument for parameter 'synthetic'", 'argument-mismatch'],
    ["ambiguous use of 'synthetic'", 'ambiguous-symbol'],
    [
      "'synthetic' is inaccessible due to 'private' protection level",
      'inaccessible-member',
    ],
    ["call can throw but is not marked with 'try'", 'unhandled-throw'],
    ["main actor-isolated property 'synthetic'", 'concurrency-isolation'],
  ]) {
    const found = nativeTestFailure(
      `native/ConcordCrypto/Tests/ConcordCryptoTests.swift:1:1: error: ${message}`,
    );
    assert.equal(found.compilerDiagnostics.sites[0].reason, reason);
  }
});

test('real failing XCTest subprocess records sanitized locations and still fails with owned cleanup', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'native-compile-diagnostic-'));
  const hidden = 'synthetic-sensitive-comparand';
  try {
    const bin = join(owned, 'bin');
    const output = join(owned, 'output');
    await mkdir(bin);
    const tool = async (name, source) =>
      writeFile(join(bin, name), `#!/usr/bin/env node\n${source}\n`, {
        mode: 0o700,
      });
    await tool(
      'xcrun',
      `const a=process.argv.slice(2);if(a[1]==='list')console.log(JSON.stringify(a[2]==='runtimes'?{runtimes:[{isAvailable:true,name:'iOS 26.1',version:'26.1',identifier:'owned-runtime'}]}:{devicetypes:[{name:'iPhone owned',identifier:'owned-phone'}]}));else if(a[1]==='create')console.log('11111111-1111-4111-8111-111111111111');`,
    );
    await tool(
      'xcodebuild',
      `if(process.argv.includes('-list'))console.log(JSON.stringify({project:{schemes:['ConcordCrypto-Unit-Tests']}}));else{console.error('/private/${hidden}/native/ConcordCrypto/Tests/ConcordCryptoTests.swift:144:27: error: cannot find \\u0027${hidden}\\u0027 in scope');process.exit(65);}`,
    );
    let childLog = '';
    await assert.rejects(
      runCommand(
        process.execPath,
        [
          fileURLToPath(new URL('./devices.mjs', import.meta.url)),
          'ios',
          output,
        ],
        {
          env: {
            ...process.env,
            RUNNER_TEMP: owned,
            PATH: `${bin}:${process.env.PATH}`,
          },
          onFailure: ({ stdout, stderr }) => {
            childLog = stdout + stderr;
          },
        },
      ),
    );
    const evidence = JSON.parse(
      await readFile(join(output, 'native-test-diagnostics.json'), 'utf8'),
    );
    assert.equal(evidence.category, 'native-test-compilation');
    assert.ok(
      evidence.compilerDiagnostics,
      'real failing compiler command must retain sanitized source locations',
    );
    assert.deepEqual(evidence.compilerDiagnostics.sites, [
      {
        file: 'ConcordCryptoTests.swift',
        line: 144,
        column: 27,
        reason: 'unknown-symbol',
      },
    ]);
    assert.equal(evidence.notRun.length, 15);
    assert.deepEqual(evidence.passed, []);
    assert.equal(childLog.includes('"status":"FAIL"'), true);
    assert.equal(childLog.includes('"line":144'), true);
    assert.equal(childLog.includes(hidden), false);
    assert.equal(childLog.includes('/private/'), false);
    assert.deepEqual(
      JSON.parse(await readFile(join(output, 'device-cleanup.json'), 'utf8')),
      { ownedSimulatorDeleted: true },
    );
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
});

test('real metadata command failure records only its fixed stage and reason before refusing Android', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'native-tool-diagnostic-'));
  const hidden = 'synthetic-sensitive-comparand';
  try {
    const sdk = join(owned, 'sdk');
    const output = join(owned, 'output');
    await mkdir(join(sdk, 'emulator'), { recursive: true });
    await writeFile(
      join(sdk, 'emulator', 'emulator'),
      `#!/usr/bin/env node\nconsole.error('error while loading shared libraries: ${hidden}: cannot open shared object file');process.exit(127);\n`,
      { mode: 0o700 },
    );
    let childLog = '';
    await assert.rejects(
      runCommand(
        process.execPath,
        [
          fileURLToPath(new URL('./devices.mjs', import.meta.url)),
          'android',
          output,
        ],
        {
          env: {
            ...process.env,
            ANDROID_HOME: sdk,
            RUNNER_TEMP: owned,
            CONCORD_ALLOW_SOFTWARE_EMULATOR: '1',
          },
          onFailure: ({ stdout, stderr }) => {
            childLog = stdout + stderr;
          },
        },
      ),
    );
    const receipt = await readFile(
      join(output, 'emulator-tool-failure.json'),
      'utf8',
    ).catch(() => null);
    assert.ok(
      receipt,
      'real failing emulator metadata command must retain its fixed failure receipt',
    );
    const evidence = JSON.parse(receipt);
    assert.deepEqual(
      evidence,
      {
        status: 'BROKEN',
        stage: 'emulator-tool',
        command: 'version',
        category: 'shared-library-unavailable',
        missingLibrary: 'UNKNOWN',
        runtime: 'NOT RUN',
      },
      '#4158: unknown emulator libraries must remain UNKNOWN and redacted while runtime is NOT RUN',
    );
    assert.equal(childLog.includes('"status":"FAIL"'), true);
    assert.equal(childLog.includes('shared-library-unavailable'), true);
    assert.equal(childLog.includes(hidden), false);
    assert.equal(childLog.includes(owned), false);
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
});

// Literal SONAMEs from the statically inspected official SDK launcher closure and
// the system libraries its qemu-system-x86_64 child needs;
// no executable is installed or run here except the owned fake subprocess.
const knownEmulatorLibraries = [
  'ld-linux-x86-64.so.2',
  'libX11.so.6',
  'libXi.so.6',
  'libabseil_dll.so',
  'libandroid-emu-agents.so',
  'libandroid-emu-base-logging.so',
  'libandroid-emu-curl.so',
  'libandroid-emu-metrics.so',
  'libandroid-emu-protos.so',
  'libc++.so',
  'libc.so.6',
  'libdl.so.2',
  'libdrm.so.2',
  'libgcc_s.so.1',
  'libglib2_linux-x86_64.so',
  'libm.so.6',
  'libnss3.so',
  'libpng16.so.16',
  'libprotobuf.so.28.4.0',
  'libpthread.so.0',
  'libpulse.so.0',
  'librt.so.1',
  'libutil.so.1',
  'libxkbfile.so.1',
];
const hiddenLibrary = 'synthetic-sensitive-comparand';
const libraryDiagnostics = [
  ...knownEmulatorLibraries.map(name => ({
    label: name,
    message: `error while loading shared libraries: ${name}: cannot open shared object file: No such file or directory\n${hiddenLibrary}`,
    expected: name,
  })),
  ...[
    `${hiddenLibrary}.so`,
    `/private/${hiddenLibrary}/libX11.so.6`,
    `libX11.so.6.${hiddenLibrary}`,
    `${hiddenLibrary}-libX11.so.6`,
    '../libX11.so.6',
    'LIBX11.so.6',
  ].map((name, index) => ({
    label: `unrecognized basename ${index}`,
    message: `error while loading shared libraries: ${name}: cannot open shared object file: No such file or directory\n${hiddenLibrary}; another token libX11.so.6`,
    expected: 'UNKNOWN',
  })),
  {
    label: 'conflicting known-library records',
    message:
      'error while loading shared libraries: libX11.so.6: cannot open shared object file\nerror while loading shared libraries: libc++.so: cannot open shared object file',
    expected: 'UNKNOWN',
  },
];
for (const { label, message, expected } of libraryDiagnostics) {
  test(`failed emulator metadata exposes only fixed known-library diagnostics: ${label}`, async () => {
    const owned = await mkdtemp(join(tmpdir(), 'native-known-library-'));
    try {
      const sdk = join(owned, 'sdk');
      const output = join(owned, 'output');
      await mkdir(join(sdk, 'emulator'), { recursive: true });
      await writeFile(
        join(sdk, 'emulator', 'emulator'),
        `#!/usr/bin/env node\nconsole.error(${JSON.stringify(
          message,
        )});process.exit(127);\n`,
        { mode: 0o700 },
      );
      let childLog = '';
      await assert.rejects(
        runCommand(
          process.execPath,
          [
            fileURLToPath(new URL('./devices.mjs', import.meta.url)),
            'android',
            output,
          ],
          {
            env: {
              ...process.env,
              ANDROID_HOME: sdk,
              RUNNER_TEMP: owned,
              CONCORD_ALLOW_SOFTWARE_EMULATOR: '1',
            },
            onFailure: ({ stdout, stderr }) => {
              childLog = stdout + stderr;
            },
          },
        ),
      );
      const receipt = JSON.parse(
        await readFile(join(output, 'emulator-tool-failure.json'), 'utf8'),
      );
      assert.equal(receipt.category, 'shared-library-unavailable');
      assert.equal(
        receipt.missingLibrary,
        expected,
        '#4158: failed emulator metadata must expose only a fixed known-library basename or UNKNOWN',
      );
      assert.equal(receipt.status, 'BROKEN');
      assert.equal(receipt.command, 'version');
      assert.equal(receipt.runtime, 'NOT RUN');
      assert.deepEqual(Object.keys(receipt).sort(), [
        'category',
        'command',
        'missingLibrary',
        'runtime',
        'stage',
        'status',
      ]);
      assert.equal(childLog.includes('"status":"FAIL"'), true);
      assert.equal(childLog.includes('android-emulator-version'), true);
      assert.equal(childLog.includes('android-emulator-start'), false);
      for (const value of [JSON.stringify(receipt), childLog]) {
        assert.equal(value.includes(hiddenLibrary), false);
        assert.equal(value.includes(owned), false);
        assert.equal(value.includes('/private/'), false);
      }
      assert.equal(
        await readFile(join(output, 'runtime.json'), 'utf8').catch(() => null),
        null,
        'failed metadata may not manufacture an Android runtime verdict',
      );
    } finally {
      await rm(owned, { recursive: true, force: true });
    }
  });
}

test('metadata failure categories preserve the exact failed command without accepting nonzero tools', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'native-tool-stage-'));
  const hidden = 'synthetic-sensitive-comparand';
  try {
    const sdk = join(owned, 'sdk');
    await mkdir(join(sdk, 'emulator'), { recursive: true });
    const properties = join(sdk, 'emulator', 'source.properties');
    for (const [command, message, category] of [
      ['version', 'Could not access KVM', 'kvm-unavailable'],
      ['version', 'could not connect to display', 'display-unavailable'],
      ['help-accel', 'unknown option', 'unsupported-command'],
      ['help-accel', 'unrecognized failure', 'command-failed'],
      ['source-properties', '', 'properties-unavailable'],
    ]) {
      await rm(properties, { force: true });
      if (command !== 'source-properties')
        await writeFile(
          properties,
          'Pkg.Revision=37.2.13\nPkg.Path=emulator\n',
        );
      await writeFile(
        join(sdk, 'emulator', 'emulator'),
        `#!/usr/bin/env node\nif(process.argv[2]==='-version'&&${JSON.stringify(
          command,
        )}!=='version')console.log('Android emulator version 37.2.13.0 (build_id 16740729) (CL:N/A)');else{console.error(${JSON.stringify(
          message + ' ' + hidden,
        )});process.exit(1);}\n`,
        { mode: 0o700 },
      );
      const output = join(owned, command + '-' + category);
      let childLog = '';
      await assert.rejects(
        runCommand(
          process.execPath,
          [
            fileURLToPath(new URL('./devices.mjs', import.meta.url)),
            'android',
            output,
          ],
          {
            env: {
              ...process.env,
              ANDROID_HOME: sdk,
              RUNNER_TEMP: owned,
              CONCORD_ALLOW_SOFTWARE_EMULATOR: '1',
            },
            onFailure: ({ stdout, stderr }) => {
              childLog = stdout + stderr;
            },
          },
        ),
      );
      const receipt = await readFile(
        join(output, 'emulator-tool-failure.json'),
        'utf8',
      ).catch(() => null);
      assert.ok(
        receipt,
        'failed emulator metadata command must retain fixed-stage diagnostics before refusing runtime',
      );
      const evidence = JSON.parse(receipt);
      assert.equal(evidence.command, command);
      assert.equal(evidence.category, category);
      assert.equal(evidence.runtime, 'NOT RUN');
      assert.equal(childLog.includes(hidden), false);
      assert.equal(childLog.includes(owned), false);
    }
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
});

const nativeNames = [
  'Argon2idMatchesDesktopHashWasmOutput',
  'Argon2idRejectsShortSalt',
  'SealUsesDesktopFramingAndRoundTrips',
  'OpenRejectsTamperingTruncationAndWrongKey',
  'DecryptMessageRejectsInvalidUTF8',
  'SpkiAndPkcs8RoundTripWithWebCryptoPrefixes',
  'KeyParsersRejectMalformedDer',
  'RejectsRsaKeysThatAreNot4096Bits',
  'ChannelKeyRejectsWrongLengthPlaintext',
  'ServiceFailsClosedOnUnknownAndWrongKindHandles',
  'ChannelKeyRoundTripsBetweenTwoIdentities',
  'CreateIdentityUnlocksWithItsOwnPasswordOnly',
  'KeychainStatusesMapToStableErrors',
];
const skipped = [
  'DesktopVectorsUnlockDecryptAndReject',
  'WritesNativeVectorsForTheDesktopVerifier',
];
const fixture = [
  ...nativeNames.map(
    name =>
      `Test Case '-[ConcordCrypto_Tests.ConcordCryptoTests test${name}]' passed (0.1 seconds).`,
  ),
  ...skipped.map(
    name =>
      `Test Case '-[ConcordCrypto_Tests.ConcordCryptoTests test${name}]' skipped (0.1 seconds).`,
  ),
].join('\n');
// Regression for #4158. Oracle: The isolated native test action enables module
// testability without changing normal Release builds, and failed emulator metadata
// exposes only a fixed known-library diagnostic while runtime remains NOT RUN.
for (const prebuiltTestable of [false, true]) {
  test(
    prebuiltTestable
      ? 'positive control: a testable module reaches all native tests and unchanged normal Release build'
      : 'isolated native test action enables module testability without changing normal Release builds',
    async () => {
      const owned = await mkdtemp(join(tmpdir(), 'native-testability-'));
      try {
        const bin = join(owned, 'bin');
        const output = join(owned, 'output');
        const calls = join(owned, 'xcode-calls.jsonl');
        const normalRelease = join(owned, 'normal-release.json');
        await mkdir(bin);
        const tool = async (name, source) =>
          writeFile(join(bin, name), `#!/usr/bin/env node\n${source}\n`, {
            mode: 0o700,
          });
        await tool(
          'xcrun',
          `const a=process.argv.slice(2);if(a[1]==='list')console.log(JSON.stringify(a[2]==='runtimes'?{runtimes:[{isAvailable:true,name:'iOS 26.1',version:'26.1',identifier:'owned-runtime'}]}:{devicetypes:[{name:'iPhone owned',identifier:'owned-phone'}]}));else if(a[1]==='create')console.log('11111111-1111-4111-8111-111111111111');`,
        );
        await tool(
          'xcodebuild',
          `const fs=require('node:fs');
const a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');
if(a.includes('-list')){console.log(JSON.stringify({project:{schemes:['ConcordCrypto-Unit-Tests']}}));process.exit(0);}
const configuration=a[a.indexOf('-configuration')+1];
const setting=a.filter(v=>v.startsWith('ENABLE_TESTABILITY=')).at(-1)?.slice('ENABLE_TESTABILITY='.length)??process.env.ENABLE_TESTABILITY;
const moduleTesting=setting==='YES'||a.some(v=>v.includes('-enable-testing'));
if(a.includes('test')){
  if(!moduleTesting&&!${JSON.stringify(
    prebuiltTestable,
  )}){console.error("native/ConcordCrypto/Tests/ConcordCryptoTests.swift:6:18: error: module 'ConcordCrypto' was not compiled for testing");process.exit(65);}
  console.log(${JSON.stringify(fixture)});process.exit(0);
}
if(a.includes('build')){
  fs.writeFileSync(${JSON.stringify(
    normalRelease,
  )},JSON.stringify({configuration,moduleTesting,scheme:a[a.indexOf('-scheme')+1]}));
  console.error('fixture intentionally stops before app runtime');process.exit(65);
}
process.exit(64);`,
        );
        let childLog = '';
        await assert.rejects(
          runCommand(
            process.execPath,
            [
              fileURLToPath(new URL('./devices.mjs', import.meta.url)),
              'ios',
              output,
            ],
            {
              env: {
                ...process.env,
                RUNNER_TEMP: owned,
                PATH: `${bin}:${process.env.PATH}`,
              },
              onFailure: ({ stdout, stderr }) => {
                childLog = stdout + stderr;
              },
            },
          ),
        );
        const matrix = await readFile(
          join(output, 'native-tests.json'),
          'utf8',
        ).catch(() => null);
        if (matrix === null) {
          const rejected = JSON.parse(
            await readFile(
              join(output, 'native-test-diagnostics.json'),
              'utf8',
            ),
          );
          assert.equal(
            rejected.category,
            'module-not-compiled-for-testing',
            'compiler fixture must reject the actual module testability defect before the named oracle fails',
          );
        }
        assert.ok(
          matrix,
          '#4158: isolated native test action must compile the module for testing and reach the required native matrix',
        );
        const summary = JSON.parse(matrix);
        assert.deepEqual(
          summary.passed,
          nativeNames.map(name => `test${name}`),
        );
        assert.deepEqual(
          summary.skipped,
          skipped.map(name => `test${name}`),
        );
        const release = await readFile(normalRelease, 'utf8').catch(() => null);
        assert.ok(
          release,
          '#4158: passing isolated native tests must reach the normal Release app build',
        );
        assert.deepEqual(
          JSON.parse(release),
          {
            configuration: 'Release',
            moduleTesting: false,
            scheme: 'ConcordVoice',
          },
          '#4158: isolated testability must not enable module testing in normal Release app builds',
        );
        const argv = (await readFile(calls, 'utf8'))
          .trim()
          .split('\n')
          .map(line => JSON.parse(line));
        assert.equal(argv.filter(args => args.includes('test')).length, 1);
        assert.equal(argv.filter(args => args.includes('build')).length, 1);
        assert.equal(
          childLog.includes('Native runtime stage: ios-runtime-build'),
          true,
        );
        assert.equal(
          childLog.includes('Native runtime stage: ios-runtime-observe'),
          false,
        );
        assert.equal(
          await readFile(join(output, 'runtime.json'), 'utf8').catch(
            () => null,
          ),
          null,
          'test compiler fixture must never claim real app runtime evidence',
        );
        assert.deepEqual(
          JSON.parse(
            await readFile(join(output, 'device-cleanup.json'), 'utf8'),
          ),
          { ownedSimulatorDeleted: true },
        );
      } finally {
        await rm(owned, { recursive: true, force: true });
      }
    },
  );
}

test('requires all thirteen real native tests and records both intentional vector skips', () => {
  const summary = nativeTestSummary(fixture);
  assert.equal(summary.passed.length, 13);
  assert.equal(summary.skipped.length, 2);
  assert.throws(() =>
    nativeTestSummary(fixture.replace("' passed", "' failed")),
  );
  assert.throws(() =>
    nativeTestSummary(fixture.split('\n').slice(1).join('\n')),
  );
  assert.throws(() =>
    nativeTestSummary(fixture.replace(' skipped', ' passed')),
  );
  assert.throws(() =>
    nativeTestSummary(fixture + '\n' + fixture.split('\n')[0]),
  );
  assert.throws(() => nativeTestSummary('** TEST SUCCEEDED **'));
});

test('requires exact installed stable Android API36 Google APIs x86_64 revision7 image', () => {
  const properties =
    'Pkg.Revision=7\nAndroidVersion.ApiLevel=36\nSystemImage.Abi=x86_64\nSystemImage.TagId=google_apis\n';
  assert.equal(
    verifyAndroidImage(properties),
    'system-images;android-36;google_apis;x86_64@7',
  );
  for (const [oldValue, wrongValue] of [
    ['=7', '=8'],
    ['=36', '=37'],
    ['=x86_64', '=arm64-v8a'],
    ['=google_apis', '=default'],
  ]) {
    assert.throws(() =>
      verifyAndroidImage(properties.replace(oldValue, wrongValue)),
    );
  }
});

test('binds exact hosted emulator version/build and positively advertised software support', () => {
  const version =
    'Android emulator version 37.2.13.0 (build_id 16740729) (CL:N/A)\n';
  const props = 'Pkg.Revision=37.2.13\nPkg.Path=emulator\n';
  const help =
    '     off    Disables acceleration entirely. Mostly useful for debugging.\n';
  const identity = inspectEmulatorTool(version, props, help);
  assert.equal(identity.version, '37.2.13.0');
  assert.equal(identity.buildId, '16740729');
  assert.equal(identity.advertisesOff, true);
  assert.doesNotThrow(() => assertEmulatorIdentity(identity));
  assert.equal(
    inspectEmulatorTool(version, props, 'off is unsupported').advertisesOff,
    false,
  );
  assert.equal(
    inspectEmulatorTool(version, props, 'off\nDisables acceleration entirely.')
      .advertisesOff,
    false,
  );
  for (const unsupported of [
    inspectEmulatorTool(version.replace('37.2.13', '37.2.14'), props, help),
    inspectEmulatorTool(version.replace('16740729', '16740730'), props, help),
    inspectEmulatorTool(version, props.replace('37.2.13', '37.2.12'), help),
  ])
    assert.throws(() => assertEmulatorIdentity(unsupported));
  for (const ambiguous of [
    inspectEmulatorTool(
      version + version.replace('37.2.13', '37.2.14'),
      props,
      help,
    ),
    inspectEmulatorTool(version, props + 'Pkg.Revision=37.2.14\n', help),
    inspectEmulatorTool(
      version,
      props + 'Pkg.Path=synthetic-sensitive-path\n',
      help,
    ),
  ]) {
    assert.equal(ambiguous.metadataAmbiguous, true);
    assert.throws(() => assertEmulatorIdentity(ambiguous));
    assert.equal(
      JSON.stringify(ambiguous).includes('synthetic-sensitive-path'),
      false,
    );
  }
});

test('writes bounded actual tool identity before refusing an unsupported binary at the CLI boundary', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'native-runtime-tool-refusal-'));
  try {
    const sdk = join(owned, 'sdk');
    const output = join(owned, 'evidence');
    await mkdir(join(sdk, 'emulator'), { recursive: true });
    await writeFile(
      join(sdk, 'emulator/source.properties'),
      'Pkg.Revision=37.2.14\nPkg.Path=emulator\n',
    );
    await writeFile(
      join(sdk, 'emulator/emulator'),
      '#!/usr/bin/env node\nif(process.argv[2]==="-version")console.log("Android emulator version 37.2.14.0 (build_id 16740730) (CL:N/A)");else if(process.argv[2]==="-help-accel")console.log("     off    Disables acceleration entirely. Mostly useful for debugging.");else process.exit(90);\n',
      { mode: 0o700 },
    );
    await assert.rejects(
      runCommand(
        process.execPath,
        [
          fileURLToPath(new URL('./devices.mjs', import.meta.url)),
          'android',
          output,
        ],
        {
          env: {
            ...process.env,
            ANDROID_HOME: sdk,
            RUNNER_TEMP: owned,
            CONCORD_ALLOW_SOFTWARE_EMULATOR: '1',
          },
        },
      ),
    );
    const receipt = JSON.parse(
      await readFile(join(output, 'emulator-tool.json'), 'utf8'),
    );
    assert.equal(receipt.toolIdentity.version, '37.2.14.0');
    assert.equal(receipt.toolIdentity.buildId, '16740730');
    assert.equal(receipt.toolIdentity.identityMatchesExpected, false);
    assert.match(receipt.toolIdentity.launcherSha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.mode, 'NOT SELECTED');
    assert.equal(receipt.runtime, 'NOT RUN');
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
});

test('retains hardware KVM prerequisite and refuses unapproved or unadvertised software mode', () => {
  assert.equal(chooseAcceleration(true, false, false), 'hardware');
  assert.equal(chooseAcceleration(true, true, true), 'hardware');
  assert.equal(chooseAcceleration(false, true, true), 'software');
  assert.throws(() => chooseAcceleration(false, false, true));
  assert.throws(() => chooseAcceleration(false, true, false));
});

test('passes explicit mode to the actual spawned emulator boundary', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'native-runtime-argv-'));
  try {
    const tool = join(owned, 'emulator-fixture.mjs');
    const result = join(owned, 'argv.json');
    await writeFile(
      tool,
      '#!/usr/bin/env node\nimport {writeFileSync} from "node:fs";writeFileSync(process.env.RUNTIME_ARGV_RESULT,JSON.stringify(process.argv.slice(2)));\n',
      { mode: 0o700 },
    );
    for (const [mode, argument] of [
      ['software', 'off'],
      ['hardware', 'on'],
    ]) {
      const child = startEmulator(tool, 'owned_test_avd', mode, {
        ...process.env,
        RUNTIME_ARGV_RESULT: result,
      });
      const exit = await new Promise((done, reject) => {
        child.once('error', reject);
        child.once('close', done);
      });
      assert.equal(exit, 0);
      const args = JSON.parse(await readFile(result, 'utf8'));
      assert.equal(args[args.indexOf('-accel') + 1], argument);
      assert.equal(args[args.indexOf('-avd') + 1], 'owned_test_avd');
      assert.equal(args.includes('-no-snapshot'), true);
    }
    assert.throws(() =>
      startEmulator(tool, 'owned_test_avd', 'auto', process.env),
    );
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
});

test('reads the current AVD-name property and falls back to the old one', () => {
  assert.equal(guestAvdName('concord_a', ''), 'concord_a');
  assert.equal(guestAvdName('', 'concord_b'), 'concord_b');
  assert.equal(guestAvdName('', ''), '');
});
