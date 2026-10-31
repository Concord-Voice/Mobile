// Owned hosted devices only. Only allowlisted app/XCTest evidence is printed or retained.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  observe,
  ProbeFailure,
  resolvedAndroidEngine,
  runCommand,
  sdkAdb,
} from './run.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mobile = resolve(here, '../..');
class DeviceFailure extends Error {}
const refuse = code => {
  throw new DeviceFailure(code);
};
const sleep = ms => new Promise(done => setTimeout(done, ms));
const stage = name => console.log(`Native runtime stage: ${name}`);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const passedNative = [
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
].map(name => `test${name}`);
const skippedNative = [
  'testDesktopVectorsUnlockDecryptAndReject',
  'testWritesNativeVectorsForTheDesktopVerifier',
];

export function chooseSimulator(runtimes, types) {
  const available = runtimes.runtimes.filter(
    runtime =>
      runtime.isAvailable && /^iOS \d+(?:\.\d+){1,2}$/.test(runtime.name),
  );
  const versionNumber = version =>
    [...version.split('.'), '0', '0']
      .slice(0, 3)
      .reduce((total, part) => total * 256 + Number(part), 0);
  available.sort((a, b) => versionNumber(b.version) - versionNumber(a.version));
  for (const runtime of available) {
    const encoded = versionNumber(runtime.version);
    const phone = types.devicetypes
      .filter(
        type =>
          /^iPhone /.test(type.name) &&
          (type.minRuntimeVersion ?? 0) <= encoded &&
          (type.maxRuntimeVersion ?? 0xffffffff) >= encoded,
      )
      .sort(
        (a, b) => (b.minRuntimeVersion ?? 0) - (a.minRuntimeVersion ?? 0),
      )[0];
    if (phone)
      return {
        runtime: runtime.identifier,
        deviceType: phone.identifier,
        osVersion: runtime.version,
      };
  }
  refuse('no-installed-ios-simulator');
}

export function nativeTestSummary(log) {
  const rows = [
    ...log.matchAll(
      /Test Case '-\[(?:[A-Za-z_][A-Za-z0-9_]*\.)?ConcordCryptoTests (test\w+)\]' (passed|skipped|failed) /g,
    ),
  ];
  const found = new Map();
  for (const [, name, state] of rows) {
    if (found.has(name)) refuse('duplicate-native-test-result');
    found.set(name, state);
  }
  if (
    found.size !== passedNative.length + skippedNative.length ||
    passedNative.some(name => found.get(name) !== 'passed') ||
    skippedNative.some(name => found.get(name) !== 'skipped')
  )
    refuse('native-test-matrix-failed');
  return {
    passed: passedNative,
    skipped: skippedNative,
    skipReason:
      'Reciprocal desktop vectors were not supplied; no cross-platform vector evidence claimed.',
  };
}

export function nativeTestFailure(log) {
  const known = [...passedNative, ...skippedNative];
  const states = new Map();
  for (const [, name, state] of log.matchAll(
    /Test Case '-\[(?:[A-Za-z_][A-Za-z0-9_]*\.)?ConcordCryptoTests (test\w+)\]' (passed|skipped|failed) /g,
  )) {
    if (known.includes(name)) states.set(name, state);
  }
  const patterns = [
    [
      /module 'ConcordCrypto' was not compiled for testing/,
      'module-not-compiled-for-testing',
    ],
    [/No such module 'ConcordCrypto'/, 'native-module-missing'],
    [
      /not currently configured for the test action/,
      'native-scheme-test-action-missing',
    ],
    [
      /Unable to find a destination matching|Ineligible destinations/,
      'native-test-destination',
    ],
    [
      /Failed to load test bundle|test bundle could not be loaded|dlopen|Library not loaded:|Symbol not found:/,
      'native-test-loader',
    ],
    [
      /Failed to (?:initialize|establish).*test|Failed to start test runner|Early unexpected exit/,
      'native-test-launch',
    ],
    [
      /No signing certificate|requires a provisioning profile|CodeSign.*failed/,
      'native-test-signing',
    ],
    [/\.swift:\d+:\d+: error:/, 'native-test-compilation'],
  ];
  const failed = known.filter(name => states.get(name) === 'failed');
  const category =
    patterns.find(([pattern]) => pattern.test(log))?.[1] ??
    (failed.length ? 'native-test-failure' : 'native-test-command-unknown');
  const evidence = {
    status: 'BROKEN',
    stage: 'native-tests',
    category,
    passed: known.filter(name => states.get(name) === 'passed'),
    skipped: known.filter(name => states.get(name) === 'skipped'),
    failed,
    notRun: known.filter(name => !states.has(name)),
  };
  if (category === 'native-test-compilation') {
    const owned = [
      ['Tests', 'ConcordCryptoTests.swift'],
      ['Sources', 'ConcordCrypto.swift'],
      ['Sources', 'ConcordKeyStore.swift'],
      ['Sources', 'ConcordKeychain.swift'],
      ['Sources', 'ConcordCryptoModule.swift'],
    ];
    const reasons = [
      [/cannot find .* in scope/i, 'unknown-symbol'],
      [/has no member/i, 'missing-member'],
      [/cannot convert value of type/i, 'type-conversion'],
      [
        /missing argument|extra argument|incorrect argument label/i,
        'argument-mismatch',
      ],
      [/ambiguous use/i, 'ambiguous-symbol'],
      [/is inaccessible due to/i, 'inaccessible-member'],
      [
        /call can throw but is not marked|errors thrown from here are not handled/i,
        'unhandled-throw',
      ],
      [/non-sendable|actor-isolated|main actor/i, 'concurrency-isolation'],
    ];
    const sites = [];
    let otherSourceErrors = false;
    let siteLimitReached = false;
    for (const match of log.matchAll(
      /^([^\n]+\.swift):(\d+):(\d+): error:([^\n]*)/gm,
    )) {
      const path = posix.normalize(match[1].replaceAll('\\', '/'));
      const entry = owned.find(([folder, file]) => {
        const relative = `native/ConcordCrypto/${folder}/${file}`;
        return path === relative || path.endsWith('/' + relative);
      });
      const line = Number(match[2]);
      const column = Number(match[3]);
      if (
        !entry ||
        !Number.isInteger(line) ||
        line < 1 ||
        line > 99999 ||
        !Number.isInteger(column) ||
        column < 1 ||
        column > 9999
      ) {
        otherSourceErrors = true;
        continue;
      }
      const site = {
        file: entry[1],
        line,
        column,
        reason:
          reasons.find(([pattern]) => pattern.test(match[4]))?.[1] ?? 'UNKNOWN',
      };
      if (sites.some(value => JSON.stringify(value) === JSON.stringify(site)))
        continue;
      if (sites.length < 8) sites.push(site);
      else siteLimitReached = true;
    }
    evidence.compilerDiagnostics = {
      sites,
      otherSourceErrors,
      siteLimitReached,
    };
  }
  return evidence;
}

// Android 12+ guests publish the AVD name as ro.boot.qemu.avd_name; older
// images used ro.kernel.qemu.avd_name.
export function guestAvdName(bootValue, kernelValue) {
  return bootValue || kernelValue;
}

export function verifyAndroidImage(properties) {
  const expected = {
    'Pkg.Revision': '7',
    'AndroidVersion.ApiLevel': '36',
    'SystemImage.Abi': 'x86_64',
    'SystemImage.TagId': 'google_apis',
  };
  for (const [name, value] of Object.entries(expected)) {
    const rows = properties
      .split(/\r?\n/)
      .filter(line => line.startsWith(`${name}=`));
    if (rows.length !== 1 || rows[0] !== `${name}=${value}`)
      refuse('android-image-identity-mismatch');
  }
  return 'system-images;android-36;google_apis;x86_64@7';
}

export function inspectEmulatorTool(versionOutput, properties, help) {
  const versionRows = versionOutput
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => line.includes('Android emulator version'));
  const propertyRows = properties.replace(/\r\n/g, '\n').split('\n');
  const revisionRows = propertyRows.filter(line =>
    line.startsWith('Pkg.Revision='),
  );
  const pathRows = propertyRows.filter(line => line.startsWith('Pkg.Path='));
  const versionMatch =
    versionRows.length === 1
      ? versionRows[0].match(
          /^(?:INFO[ \t]+\|[ \t]+)?Android emulator version ([0-9]{1,4}(?:\.[0-9]{1,4}){2,3}) \(build_id ([0-9]{1,20})\)/,
        )
      : null;
  const revision =
    revisionRows.length === 1
      ? revisionRows[0].match(
          /^Pkg\.Revision=([0-9]{1,4}(?:\.[0-9]{1,4}){2,3})$/,
        )?.[1]
      : null;
  const version = versionMatch?.[1] ?? 'UNKNOWN';
  const buildId = versionMatch?.[2] ?? 'UNKNOWN';
  const packagePath =
    pathRows.length === 1 && pathRows[0] === 'Pkg.Path=emulator'
      ? 'emulator'
      : 'UNKNOWN';
  const metadataAmbiguous =
    versionRows.length > 1 || revisionRows.length > 1 || pathRows.length > 1;
  const advertisesOff =
    /^[ \t]*off[ \t]+Disables acceleration entirely\./m.test(
      help.replace(/\r\n/g, '\n'),
    );
  return {
    version,
    buildId,
    packageRevision: revision ?? 'UNKNOWN',
    packagePath,
    metadataAmbiguous,
    identityMatchesExpected:
      !metadataAmbiguous &&
      version === '37.2.13.0' &&
      buildId === '16740729' &&
      ['37.2.13', '37.2.13.0'].includes(revision) &&
      packagePath === 'emulator',
    sourcePropertiesSha256: sha256(properties),
    helpAccelSha256: sha256(help),
    advertisesOff,
    offSupportStatement: advertisesOff
      ? 'off Disables acceleration entirely.'
      : null,
  };
}

export function assertEmulatorIdentity(identity) {
  if (identity.metadataAmbiguous) refuse('ambiguous-emulator-metadata');
  if (identity.identityMatchesExpected !== true)
    refuse('emulator-binary-identity-mismatch');
}

export function chooseAcceleration(hasKvm, allowSoftware, advertisesOff) {
  if (hasKvm === true) return 'hardware';
  if (allowSoftware !== true) refuse('android-kvm-unavailable');
  if (advertisesOff !== true) refuse('software-emulation-not-advertised');
  return 'software';
}

export function startEmulator(executable, name, mode, env) {
  if (!['hardware', 'software'].includes(mode)) refuse('invalid-emulator-mode');
  return spawn(
    executable,
    [
      '-avd',
      name,
      '-port',
      '5580',
      '-no-window',
      '-no-audio',
      '-no-boot-anim',
      '-no-snapshot',
      // More than the image default (about 2 GB) for the release APK install;
      // the hosted runner has 16 GB.
      '-memory',
      '4096',
      '-gpu',
      'swiftshader',
      '-accel',
      mode === 'software' ? 'off' : 'on',
    ],
    { env, stdio: 'ignore' },
  );
}

async function ios(output) {
  stage('ios-create');
  const selected = chooseSimulator(
    JSON.parse(
      await runCommand('xcrun', ['simctl', 'list', 'runtimes', '--json']),
    ),
    JSON.parse(
      await runCommand('xcrun', ['simctl', 'list', 'devicetypes', '--json']),
    ),
  );
  const device = (
    await runCommand('xcrun', [
      'simctl',
      'create',
      `concord-runtime-${randomBytes(8).toString('hex')}`,
      selected.deviceType,
      selected.runtime,
    ])
  ).trim();
  if (!/^[0-9A-F-]{36}$/i.test(device)) refuse('invalid-created-simulator');
  let primary;
  try {
    stage('ios-boot');
    await runCommand('xcrun', ['simctl', 'boot', device]);
    await runCommand('xcrun', ['simctl', 'bootstatus', device, '-b'], {
      timeout: 300000,
    });
    const project = 'ios/Pods/Pods.xcodeproj';
    const scheme = 'ConcordCrypto-Unit-Tests';
    const list = JSON.parse(
      await runCommand('xcodebuild', ['-list', '-json', '-project', project], {
        timeout: 120000,
      }),
    );
    if (!list.project?.schemes?.includes(scheme))
      refuse('native-test-scheme-missing');
    stage('ios-native-tests');
    const nativeDerived = join(output, 'native-tests-derived');
    const recordNativeFailure = async log => {
      const evidence = nativeTestFailure(log);
      await writeFile(
        join(output, 'native-test-diagnostics.json'),
        JSON.stringify(evidence, null, 2) + '\n',
      );
      console.log(JSON.stringify({ nativeTestFailure: evidence }));
    };
    try {
      const nativeLog = await runCommand(
        'xcodebuild',
        [
          '-project',
          project,
          '-scheme',
          scheme,
          '-configuration',
          'Release',
          '-sdk',
          'iphonesimulator',
          '-destination',
          `id=${device}`,
          '-derivedDataPath',
          nativeDerived,
          '-parallel-testing-enabled',
          'NO',
          '-jobs',
          '2',
          'ENABLE_TESTABILITY=YES',
          'test',
        ],
        {
          timeout: 600000,
          onFailure: ({ stdout, stderr }) =>
            recordNativeFailure(stdout + '\n' + stderr),
        },
      );
      let nativeTests;
      try {
        nativeTests = nativeTestSummary(nativeLog);
      } catch (error) {
        await recordNativeFailure(nativeLog);
        throw error;
      }
      await writeFile(
        join(output, 'native-tests.json'),
        JSON.stringify(nativeTests, null, 2) + '\n',
      );
      console.log(JSON.stringify({ nativeTests }));
    } finally {
      // XCTest owns raw xcresult/log files here; retain only the sanitized test matrix.
      await rm(nativeDerived, { recursive: true, force: true });
    }
    const derived = join(output, 'runtime-derived');
    stage('ios-runtime-build');
    await runCommand(
      'xcodebuild',
      [
        '-workspace',
        'ios/ConcordVoice.xcworkspace',
        '-scheme',
        'ConcordVoice',
        '-configuration',
        'Release',
        '-sdk',
        'iphonesimulator',
        '-destination',
        `id=${device}`,
        '-derivedDataPath',
        derived,
        '-jobs',
        '2',
        'build',
      ],
      {
        timeout: 1200000,
        env: {
          ...process.env,
          ENTRY_FILE: 'scripts/native-runtime-probe/index.tsx',
        },
      },
    );
    stage('ios-runtime-observe');
    await observe(
      'ios',
      device,
      join(derived, 'Build/Products/Release-iphonesimulator/ConcordVoice.app'),
      join(output, 'manifest.json'),
      join(output, 'runtime.json'),
      { ...selected, ownedFreshDevice: true },
    );
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      stage('ios-cleanup');
      // Never touch a pre-existing simulator. This UDID came from our own create above.
      await runCommand('xcrun', ['simctl', 'shutdown', device]).catch(() => {});
      await runCommand('xcrun', ['simctl', 'delete', device]);
      await writeFile(
        join(output, 'device-cleanup.json'),
        '{"ownedSimulatorDeleted":true}\n',
      );
      console.log(
        JSON.stringify({ deviceCleanup: { ownedSimulatorDeleted: true } }),
      );
    } catch (cleanupError) {
      // Keep the first failure; a later cleanup failure must not replace it.
      if (!primary) throw cleanupError;
      console.log(JSON.stringify({ cleanupFailedAfterFailure: true }));
    }
  }
}

async function android(output) {
  stage('android-tool-prerequisites');
  const sdk = process.env.ANDROID_HOME;
  if (!sdk || !process.env.RUNNER_TEMP) refuse('android-tools-unavailable');
  const executable = join(sdk, 'emulator/emulator');
  const adbTool = sdkAdb();
  const recordToolFailure = async (command, log) => {
    const evidence = {
      status: 'BROKEN',
      stage: 'emulator-tool',
      command,
      category:
        /error while loading shared libraries|cannot open shared object file/i.test(
          log,
        )
          ? 'shared-library-unavailable'
          : /could not access KVM|KVM.*permission denied|requires hardware acceleration/i.test(
              log,
            )
          ? 'kvm-unavailable'
          : /could not connect to display|could not load the Qt platform plugin/i.test(
              log,
            )
          ? 'display-unavailable'
          : /unknown option|unknown command-line option/i.test(log)
          ? 'unsupported-command'
          : command === 'source-properties'
          ? 'properties-unavailable'
          : 'command-failed',
      runtime: 'NOT RUN',
    };
    if (evidence.category === 'shared-library-unavailable') {
      // Fixed SONAME inventory: the pinned launcher's static DT_NEEDED closure plus
      // the system libraries qemu-system-x86_64 needs, since -version execs qemu.
      // A name outside this set, path, lookalike or ambiguous record stays UNKNOWN.
      const known = [
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
      const fields = [
        ...log.matchAll(/error while loading shared libraries: ([^:\r\n]+):/g),
      ];
      evidence.missingLibrary =
        fields.length === 1 && known.includes(fields[0][1])
          ? fields[0][1]
          : 'UNKNOWN';
    }
    await writeFile(
      join(output, 'emulator-tool-failure.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    );
    console.log(JSON.stringify({ emulatorToolFailure: evidence }));
  };
  const metadata = (command, args) =>
    runCommand(executable, args, {
      onFailure: ({ stdout, stderr }) =>
        recordToolFailure(command, stdout + '\n' + stderr),
    });
  stage('android-emulator-version');
  const versionOutput = await metadata('version', ['-version']);
  stage('android-emulator-properties');
  let properties;
  try {
    properties = await readFile(
      join(sdk, 'emulator/source.properties'),
      'utf8',
    );
  } catch {
    await recordToolFailure('source-properties', '');
    refuse('emulator-properties-unavailable');
  }
  stage('android-emulator-help');
  const help = await metadata('help-accel', ['-help-accel']);
  const toolIdentity = inspectEmulatorTool(versionOutput, properties, help);
  toolIdentity.launcherSha256 = sha256(await readFile(executable));
  const hasKvm = await Promise.all([
    access('/dev/kvm', constants.R_OK),
    access('/dev/kvm', constants.W_OK),
  ]).then(
    () => true,
    () => false,
  );
  const prerequisites = {
    toolIdentity,
    mode: 'NOT SELECTED',
    kvmAccessible: hasKvm,
    runtime: 'NOT RUN',
  };
  await writeFile(
    join(output, 'emulator-tool.json'),
    JSON.stringify(prerequisites, null, 2) + '\n',
  );
  console.log(JSON.stringify({ emulatorPrerequisites: prerequisites }));
  assertEmulatorIdentity(toolIdentity);
  const optIn = process.env.CONCORD_ALLOW_SOFTWARE_EMULATOR;
  if (optIn !== undefined && optIn !== '1')
    refuse('invalid-software-emulator-opt-in');
  const mode = chooseAcceleration(
    hasKvm,
    optIn === '1',
    toolIdentity.advertisesOff,
  );
  prerequisites.mode = mode;
  await writeFile(
    join(output, 'emulator-tool.json'),
    JSON.stringify(prerequisites, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      emulatorSelection: { mode, kvmAccessible: hasKvm, runtime: 'NOT RUN' },
    }),
  );
  stage('android-image');
  const image = verifyAndroidImage(
    await readFile(
      join(
        sdk,
        'system-images/android-36/google_apis/x86_64/source.properties',
      ),
      'utf8',
    ),
  );
  const name = `concord_runtime_${randomBytes(8).toString('hex')}`;
  const owned = await mkdtemp(
    join(process.env.RUNNER_TEMP, 'mobile-runtime-device-'),
  );
  const env = { ...process.env, ANDROID_AVD_HOME: owned };
  const serial = 'emulator-5580';
  let emulator;
  let exited = false;
  let primary;
  try {
    if (
      (await runCommand(adbTool, ['devices']))
        .split('\n')
        .some(line => line.startsWith(serial))
    )
      refuse('emulator-port-already-used');
    stage('android-create');
    // Android's package tools create only our named AVD in the owned temporary directory.
    await runCommand(
      join(sdk, 'cmdline-tools/latest/bin/avdmanager'),
      [
        'create',
        'avd',
        '--force',
        '--name',
        name,
        '--package',
        'system-images;android-36;google_apis;x86_64',
        '--device',
        'pixel_7',
      ],
      { env, input: 'no\n' },
    );
    stage('android-boot');
    emulator = startEmulator(executable, name, mode, env);
    emulator.once('error', () => {
      exited = true;
    });
    emulator.once('exit', () => {
      exited = true;
    });
    const adb = args => runCommand(adbTool, ['-s', serial, ...args]);
    const deadline = Date.now() + 300000;
    let booted = false;
    while (Date.now() < deadline) {
      if (exited) refuse('emulator-exited');
      if (
        (
          await adb(['shell', 'getprop', 'sys.boot_completed']).catch(() => '')
        ).trim() === '1'
      ) {
        booted = true;
        break;
      }
      await sleep(1000);
    }
    if (!booted) refuse('emulator-boot-timeout');
    const prop = async key =>
      (await adb(['shell', 'getprop', key])).trim().slice(0, 64);
    const guest = {
      avdName: guestAvdName(
        await prop('ro.boot.qemu.avd_name'),
        await prop('ro.kernel.qemu.avd_name'),
      ),
      sdk: await prop('ro.build.version.sdk'),
      abi: await prop('ro.product.cpu.abi'),
    };
    if (
      guest.avdName !== name ||
      guest.sdk !== '36' ||
      guest.abi !== 'x86_64'
    ) {
      console.log(
        JSON.stringify({
          guestIdentity: {
            avdNameMatches: guest.avdName === name,
            sdk: /^[0-9]{1,3}$/.test(guest.sdk) ? guest.sdk : 'UNKNOWN',
            abi: /^[a-z0-9_-]{1,16}$/.test(guest.abi) ? guest.abi : 'UNKNOWN',
          },
        }),
      );
      refuse('guest-identity-mismatch');
    }
    stage('android-runtime-build');
    await runCommand(
      './gradlew',
      [
        ':app:assembleRelease',
        '--no-daemon',
        '--max-workers=2',
        '-PreactNativeArchitectures=x86_64',
      ],
      {
        cwd: join(mobile, 'android'),
        timeout: 1200000,
        env: {
          ...process.env,
          ENTRY_FILE: 'scripts/native-runtime-probe/index.tsx',
        },
      },
    );
    const expected = JSON.parse(
      await readFile(join(output, 'manifest.json'), 'utf8'),
    );
    stage('android-native-dependency');
    const dependencies = await runCommand(
      './gradlew',
      [
        ':app:dependencyInsight',
        '--configuration',
        'releaseRuntimeClasspath',
        '--dependency',
        'hermes-android',
        '--no-daemon',
        '--max-workers=2',
      ],
      { cwd: join(mobile, 'android'), timeout: 180000 },
    );
    const nativeCoordinate = resolvedAndroidEngine(
      dependencies,
      expected.nativeEnginePackage,
    );
    const key = join(owned, 'probe.p12');
    stage('android-test-signature');
    const signingEnv = {
      ...process.env,
      PROBE_STOREPASS: randomBytes(32).toString('hex'),
    };
    await runCommand(
      'keytool',
      [
        '-genkeypair',
        '-keystore',
        key,
        '-storetype',
        'PKCS12',
        '-storepass:env',
        'PROBE_STOREPASS',
        '-keypass:env',
        'PROBE_STOREPASS',
        '-alias',
        'native-runtime-probe',
        '-keyalg',
        'RSA',
        '-keysize',
        '4096',
        '-validity',
        '1',
        '-dname',
        'CN=Disposable Runtime Probe',
      ],
      { env: signingEnv, timeout: 60000 },
    );
    const signed = join(owned, 'runtime-test.apk');
    const apksigner = join(sdk, 'build-tools/37.0.0/apksigner');
    await runCommand(
      apksigner,
      [
        'sign',
        '--ks',
        key,
        '--ks-key-alias',
        'native-runtime-probe',
        '--ks-pass',
        'env:PROBE_STOREPASS',
        '--key-pass',
        'env:PROBE_STOREPASS',
        '--out',
        signed,
        join(
          mobile,
          'android/app/build/outputs/apk/release/app-release-unsigned.apk',
        ),
      ],
      { env: signingEnv },
    );
    await runCommand(apksigner, ['verify', '--verbose', signed]);
    stage('android-runtime-observe');
    await observe(
      'android',
      serial,
      signed,
      join(output, 'manifest.json'),
      join(output, 'runtime.json'),
      {
        image,
        nativeCoordinate,
        guestApi: 36,
        guestAbi: 'x86_64',
        disposableTestSignature: true,
        ownedFreshDevice: true,
        acceleration: mode,
        kvmAccessible: hasKvm,
        emulator: toolIdentity,
      },
    );
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      stage('android-cleanup');
      // Signal only the child we created; never kill a shared adb server or unrelated emulator.
      if (emulator && !exited) emulator.kill('SIGTERM');
      const end = Date.now() + 15000;
      while (emulator && !exited && Date.now() < end) await sleep(100);
      if (emulator && !exited) {
        emulator.kill('SIGKILL');
        await sleep(500);
      }
      if (emulator && !exited) refuse('owned-emulator-cleanup-failed');
      await rm(owned, { recursive: true });
      await writeFile(
        join(output, 'device-cleanup.json'),
        '{"ownedEmulatorStopped":true,"ownedAvdAndKeyDeleted":true}\n',
      );
      console.log(
        JSON.stringify({
          deviceCleanup: {
            ownedEmulatorStopped: true,
            ownedAvdAndKeyDeleted: true,
          },
        }),
      );
    } catch (cleanupError) {
      // Keep the first failure; a later cleanup failure must not replace it.
      if (!primary) throw cleanupError;
      console.log(JSON.stringify({ cleanupFailedAfterFailure: true }));
    }
  }
}

async function main() {
  const [platform, output] = process.argv.slice(2);
  if (
    !['ios', 'android'].includes(platform) ||
    !output ||
    !process.env.RUNNER_TEMP ||
    !resolve(output).startsWith(resolve(process.env.RUNNER_TEMP) + '/')
  )
    refuse('invalid-device-command');
  await mkdir(output, { recursive: true });
  if (platform === 'ios') await ios(output);
  else await android(output);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(error => {
    console.error(
      JSON.stringify({
        status: 'FAIL',
        code:
          error instanceof DeviceFailure || error instanceof ProbeFailure
            ? error.message
            : 'native-device-command-failed',
      }),
    );
    process.exitCode = 1;
  });
}
