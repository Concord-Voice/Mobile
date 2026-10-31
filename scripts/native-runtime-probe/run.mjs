import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const mobile = resolve(here, '../..');
export const prefix = 'CONCORD_NATIVE_RUNTIME ';
export const cases = {
  ios: [
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
  ],
  android: [
    'layout',
    'nativeVersion',
    'hermesRuntime',
    'nativeUnavailable',
    'missingModuleRefusal',
  ],
};
export class ProbeFailure extends Error {}
// The Hermes engine and compiler version React Native 0.88.0 pins.
const HERMES_ENGINE_VERSION = '260318099.0.4';
const refuse = code => {
  throw new ProbeFailure(code);
};
const keysAre = (value, names) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...names].sort());

export function validateVerdict(value, expected) {
  if (
    !keysAre(value, [
      'schema',
      'nonce',
      'sourceHead',
      'platform',
      'rnVersion',
      'reactVersion',
      'hermes',
      'checks',
      'passed',
      'failureCase',
    ])
  )
    refuse('invalid-verdict-fields');
  for (const key of [
    'schema',
    'nonce',
    'sourceHead',
    'platform',
    'rnVersion',
    'reactVersion',
  ]) {
    if (value[key] !== expected[key]) refuse('runtime-identity-mismatch');
  }
  if (
    !keysAre(value.hermes, ['ossVersion', 'build']) ||
    value.hermes.ossVersion !== expected.ossVersion ||
    value.hermes.build !== 'Release'
  ) {
    // The app bounds both values before reporting them; re-check the shape here.
    const shown = (text, pattern) =>
      typeof text === 'string' && pattern.test(text) ? text : 'UNKNOWN';
    console.log(
      JSON.stringify({
        runtimeEngine: {
          expectedOssVersion: expected.ossVersion,
          reportedOssVersion: shown(value.hermes?.ossVersion, /^[0-9.]{1,30}$/),
          reportedBuild: shown(value.hermes?.build, /^[A-Za-z0-9 _.-]{1,40}$/),
        },
      }),
    );
    refuse('runtime-engine-mismatch');
  }
  const required = cases[expected.platform];
  if (!required || !keysAre(value.checks, required))
    refuse('runtime-case-set-mismatch');
  if (
    value.passed !== true ||
    value.failureCase !== null ||
    required.some(k => value.checks[k] !== true)
  ) {
    refuse('runtime-cases-failed');
  }
  return value;
}

export function inspectBytecode(bytes, expectedVersion) {
  if (bytes.length < 12 || bytes.readBigUInt64LE(0) !== 0x1f1903c103bc1fc6n)
    refuse('not-hermes-bytecode');
  const version = bytes.readUInt32LE(8);
  if (version !== expectedVersion) refuse('bytecode-version-mismatch');
  return version;
}

export function extractVerdict(log, expected, pid) {
  const found = [];
  for (const line of log.split('\n')) {
    let message = line;
    if (expected.platform === 'ios') {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.processID !== pid) continue;
      message = row.eventMessage;
    }
    if (typeof message !== 'string' || !message.startsWith(prefix)) continue;
    if (message.length > 8192) refuse('oversized-runtime-verdict');
    let value;
    try {
      value = JSON.parse(message.slice(prefix.length));
    } catch {
      refuse('malformed-runtime-verdict');
    }
    if (value.nonce !== expected.nonce) continue;
    found.push(validateVerdict(value, expected));
  }
  if (found.length > 1) refuse('duplicate-runtime-verdict');
  return found[0] ?? null;
}

// The adb from the SDK platform-tools package; the hosted runner's PATH has none.
export function sdkAdb(env = process.env) {
  if (!env.ANDROID_HOME) refuse('android-sdk-unavailable');
  return join(env.ANDROID_HOME, 'platform-tools/adb');
}

// Sanitized category for a failed adb step: only a fixed install-failure code
// or a fixed label leaves the process, never raw adb output.
export function androidObserveFailure(step, log) {
  const install =
    log.match(/\bINSTALL_(?:FAILED|PARSE_FAILED)_[A-Z_]{1,64}\b/)?.[0] ??
    log.match(/Failure \[([A-Z][A-Z0-9_]{0,63})\b/)?.[1];
  const category =
    install ??
    (/device (?:offline|not found)|no devices\/emulators found/i.test(log)
      ? 'device-unavailable'
      : /Activity class .{1,200} does not exist/i.test(log)
      ? 'activity-missing'
      : /protocol fault|broken pipe|connection reset/i.test(log)
      ? 'adb-transport'
      : /Can't find service: package|cmd: Failure calling service package/i.test(
          log,
        )
      ? 'package-service-unavailable'
      : /failed to (?:stat|read|open)/i.test(log)
      ? 'apk-unreadable'
      : /Exception occurred while executing|^\s+at [\w$.]+\(/m.test(log)
      ? 'package-service-exception'
      : /timed out|ETIMEDOUT/i.test(log)
      ? 'timed-out'
      : 'command-failed');
  // Whether adb printed anything, so a silent kill reads differently from an unknown message.
  // For an unknown message, keep only plain words from its last line: paths,
  // numbers, hex and punctuation are dropped, so no value or path can leak.
  const lastLine =
    log
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .pop() ?? '';
  const words =
    category === 'command-failed'
      ? lastLine
          .split(/\s+/)
          .map(word => word.replace(/[:,.;]+$/, ''))
          .filter(word => /^[A-Za-z][a-z]{1,23}$/.test(word))
          .slice(0, 12)
      : [];
  // A Java exception class name is a fixed identifier, never a value.
  const exception = log.match(
    /\b((?:java|android)\.[a-z.]{1,60}\.[A-Z][A-Za-z]{0,60}(?:Exception|Error))\b/,
  )?.[1];
  return {
    androidObserveFailure: {
      step,
      category,
      ...(exception ? { exception } : {}),
      emptyOutput: !log.trim(),
      ...(words.length ? { words } : {}),
    },
  };
}

export async function runCommand(
  file,
  args,
  {
    binary = false,
    timeout = 15000,
    env = process.env,
    cwd = mobile,
    input = '',
    onFailure,
  } = {},
) {
  try {
    const pending = exec(file, args, {
      encoding: binary ? 'buffer' : 'utf8',
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      env,
      cwd,
    });
    // A quick tool such as hermesc --version may exit before stdin is closed.
    // EPIPE is harmless when the child itself exits successfully; do not leak a raw stack.
    let inputFailed = false;
    pending.child.stdin?.on('error', error => {
      if (error.code !== 'EPIPE') inputFailed = true;
    });
    pending.child.stdin?.end(input);
    const result = await pending;
    if (inputFailed) refuse('platform-command-failed');
    return result.stdout;
  } catch (error) {
    try {
      if (onFailure)
        await onFailure({
          stdout: typeof error.stdout === 'string' ? error.stdout : '',
          stderr: typeof error.stderr === 'string' ? error.stderr : '',
        });
    } finally {
      refuse('platform-command-failed');
    }
  }
}
export async function startLogCollector(file, args) {
  let text = '';
  let failed = null;
  let stopping = false;
  const child = spawn(file, args, {
    cwd: mobile,
    env: process.env,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const done = new Promise(resolveDone => child.once('close', resolveDone));
  child.on('error', () => {
    failed = 'native-log-collector-failed';
  });
  child.on('exit', () => {
    if (!stopping) failed ??= 'native-log-collector-exited';
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    if (failed) return;
    text += chunk;
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) {
      failed = 'native-log-limit';
      child.kill('SIGTERM');
    }
  });
  await new Promise(resolveStarted => {
    child.once('spawn', resolveStarted);
    child.once('error', resolveStarted);
  });
  return {
    read() {
      if (failed) refuse(failed);
      return text;
    },
    async stop() {
      stopping = true;
      child.kill('SIGTERM');
      let timer;
      try {
        await Promise.race([
          done,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              child.kill('SIGKILL');
              reject(new ProbeFailure('native-log-cleanup-timeout'));
            }, 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (failed) refuse(failed);
    },
  };
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function nativeSelection(platform, text) {
  const selected =
    platform === 'ios'
      ? text.match(/^ {2}- hermes-engine \(([0-9.]+)\):$/m)?.[1]
      : text.match(/^HERMES_VERSION_NAME=([0-9.]+)$/m)?.[1];
  if (selected !== HERMES_ENGINE_VERSION) refuse('native-engine-selection-mismatch');
  return selected;
}
export function resolvedAndroidEngine(text, expectedVersion) {
  const selected = [
    ...text.matchAll(
      /^com\.facebook\.hermes:hermes-android:([0-9.]+)(?:[^\S\r\n].*)?$/gm,
    ),
  ];
  if (selected.length !== 1 || selected[0][1] !== expectedVersion)
    refuse('resolved-native-engine-mismatch');
  return `com.facebook.hermes:hermes-android:${selected[0][1]}`;
}

async function prepare(platform, target) {
  if (
    !cases[platform] ||
    !/^[0-9a-f]{40}$/.test(process.env.SOURCE_HEAD_SHA ?? '') ||
    !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '')
  )
    refuse('invalid-prepare-identity');
  const pkg = JSON.parse(await readFile(join(mobile, 'package.json'), 'utf8'));
  const rn = JSON.parse(
    await readFile(
      join(mobile, 'node_modules/react-native/package.json'),
      'utf8',
    ),
  );
  const compiler = JSON.parse(
    await readFile(
      join(mobile, 'node_modules/hermes-compiler/package.json'),
      'utf8',
    ),
  );
  if (
    rn.version !== pkg.dependencies['react-native'] ||
    rn.version !== '0.88.0' ||
    compiler.version !== HERMES_ENGINE_VERSION
  )
    refuse('installed-version-mismatch');
  const selectionBytes = await readFile(
    join(
      mobile,
      platform === 'ios'
        ? 'ios/Podfile.lock'
        : 'node_modules/react-native/sdks/hermes-engine/version.properties',
    ),
  );
  const nativeEnginePackage = nativeSelection(
    platform,
    selectionBytes.toString(),
  );
  const compilerPath = join(
    mobile,
    'node_modules/hermes-compiler/hermesc',
    process.platform === 'darwin' ? 'osx-bin' : 'linux64-bin',
    'hermesc',
  );
  const version = await runCommand(compilerPath, ['--version']);
  const compilerReleaseVersion = version.match(
    /Hermes release version: ([0-9.]+)/,
  )?.[1];
  const hbcVersion = Number(version.match(/HBC bytecode version: (\d+)/)?.[1]);
  if (!compilerReleaseVersion || !Number.isSafeInteger(hbcVersion))
    refuse('missing-compiler-version');
  const manifest = {
    schema: 1,
    nonce: randomBytes(16).toString('hex'),
    sourceHead: process.env.SOURCE_HEAD_SHA,
    checkoutCommit: (await runCommand('git', ['rev-parse', 'HEAD'])).trim(),
    runId: process.env.GITHUB_RUN_ID,
    platform,
    rnVersion: rn.version,
    reactVersion: pkg.dependencies.react,
    compilerPackage: compiler.version,
    nativeEnginePackage,
    nativeSelectionSha256: sha256(selectionBytes),
    // The runtime reports the OSS release version embedded in the native engine,
    // so it must equal the selected engine package. The compiler's self-reported
    // release differs by host build (the Linux hermesc prints 1.0.0), so it is
    // recorded separately and not compared with the runtime.
    ossVersion: nativeEnginePackage,
    compilerReleaseVersion,
    hbcVersion,
  };
  await writeFile(target, JSON.stringify(manifest), {
    mode: 0o600,
    flag: 'wx',
  });
  await writeFile(
    join(here, 'manifest.generated.ts'),
    // The synthetic password goes only into the bundled entry, never into the
    // uploaded manifest or reports, unlike the published nonce.
    `export default ${JSON.stringify({
      ...manifest,
      syntheticPassword: randomBytes(24).toString('base64url'),
    })};\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log('Prepared isolated native runtime probe');
}

async function artifacts(platform, app, expected) {
  let bundle, library;
  if (platform === 'ios') {
    bundle = await readFile(join(app, 'main.jsbundle'));
    library = await readFile(
      join(app, 'Frameworks/hermesvm.framework/hermesvm'),
    );
  } else {
    const entries = (await runCommand('unzip', ['-Z1', app])).split('\n');
    const libs = entries.filter(n =>
      /^lib\/x86_64\/libhermes(?:vm)?\.so$/.test(n),
    );
    if (libs.length !== 1) refuse('native-hermes-library-missing');
    bundle = await runCommand(
      'unzip',
      ['-p', app, 'assets/index.android.bundle'],
      { binary: true },
    );
    library = await runCommand('unzip', ['-p', app, libs[0]], { binary: true });
  }
  return {
    bundleSha256: sha256(bundle),
    nativeHermesLibrarySha256: sha256(library),
    bundleHbcVersion: inspectBytecode(bundle, expected.hbcVersion),
    compilerPackage: expected.compilerPackage,
    nativeEnginePackage: expected.nativeEnginePackage,
    nativeSelectionSha256: expected.nativeSelectionSha256,
  };
}

export async function observe(
  platform,
  device,
  app,
  manifestPath,
  output,
  platformEvidence = {},
) {
  const expected = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!/^[0-9a-f]{32}$/.test(expected.nonce) || expected.platform !== platform)
    refuse('invalid-manifest');
  const binding = await artifacts(platform, app, expected);
  const bundleId = 'com.concordvoice.mobile';
  let pid, logs, alive;
  let collector;
  let primary;
  try {
    if (platform === 'ios') {
      if (!/^[0-9A-F-]{36}$/i.test(device)) refuse('invalid-simulator');
      await runCommand('xcrun', ['simctl', 'install', device, app], {
        timeout: 30000,
      });
      collector = await startLogCollector('xcrun', [
        'simctl',
        'spawn',
        device,
        'log',
        'stream',
        '--style',
        'ndjson',
        '--level',
        'info',
        '--predicate',
        'subsystem == "com.facebook.react.log" AND category == "javascript"',
      ]);
      // Allow the live consumer to start before the app. Only a matching positive report can pass.
      await new Promise(resolveReady => setTimeout(resolveReady, 1000));
      collector.read();
      const launched = await runCommand('xcrun', [
        'simctl',
        'launch',
        device,
        bundleId,
      ]);
      pid = Number(launched.match(/com\.concordvoice\.mobile:\s*(\d+)/)?.[1]);
      logs = async () => collector.read();
      alive = async () => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
    } else {
      if (!/^emulator-\d{4,5}$/.test(device)) refuse('invalid-emulator');
      const adbTool = sdkAdb();
      const adb = (args, options) =>
        runCommand(adbTool, ['-s', device, ...args], options);
      const reportFailure = step => ({ stdout, stderr }) =>
        console.log(
          JSON.stringify(androidObserveFailure(step, `${stdout}\n${stderr}`)),
        );
      // pidof exits 1 when the process is absent; that is an absent app, not a tool failure.
      const pidOf = async () =>
        Number(
          (
            await adb(['shell', 'pidof', '-s', bundleId]).catch(() => '')
          ).trim(),
        );
      // sys.boot_completed can precede the package manager service; wait for it.
      const waitForPackageManager = async () => {
        const pmDeadline = Date.now() + 60000;
        while (
          !(
            await adb(['shell', 'pm', 'path', 'android']).catch(() => '')
          ).startsWith('package:')
        ) {
          if (Date.now() > pmDeadline) refuse('package-manager-unavailable');
          await new Promise(resolveWait => setTimeout(resolveWait, 1000));
        }
      };
      await waitForPackageManager();
      // Disposable guest only: skip install-time package verification, which on
      // Google APIs images runs inside the install and can stall or crash it.
      await adb(['shell', 'settings', 'put', 'global', 'verifier_verify_adb_installs', '0']);
      await adb(['shell', 'settings', 'put', 'global', 'package_verifier_enable', '0']);
      // A transport drop (protocol fault, broken pipe, reset) or a package manager
      // exception or restart on the freshly booted guest is retried twice on the
      // same owned device, once the package manager answers again. Any other failure, including every INSTALL_* refusal, fails at once.
      for (let attempt = 1; ; attempt++) {
        let transport = false;
        try {
          // Streamed install: the --no-streaming path hit a repeatable package
          // manager NullPointerException on the API 36 guest.
          await adb(['install', app], {
            timeout: 120000,
            onFailure: ({ stdout, stderr }) => {
              const failure = androidObserveFailure(
                'install',
                `${stdout}\n${stderr}`,
              );
              failure.androidObserveFailure.attempt = attempt;
              transport = [
                'adb-transport',
                'package-service-exception',
                'package-service-unavailable',
              ].includes(failure.androidObserveFailure.category);
              console.log(JSON.stringify(failure));
            },
          });
          break;
        } catch (error) {
          if (!transport || attempt >= 3) throw error;
          await adb(['wait-for-device'], { timeout: 60000 });
          await waitForPackageManager();
        }
      }
      await adb(
        [
          'shell',
          'am',
          'start',
          '-W',
          '-n',
          `${bundleId}/com.concordvoice.MainActivity`,
        ],
        { timeout: 60000, onFailure: reportFailure('launch') },
      );
      pid = await pidOf();
      logs = () =>
        adb([
          'logcat',
          `--pid=${pid}`,
          '-d',
          '-v',
          'raw',
          'ReactNativeJS:I',
          '*:S',
        ]);
      alive = async () => (await pidOf()) === pid;
    }
    if (!Number.isSafeInteger(pid) || pid <= 0)
      refuse('application-not-running');
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (!(await alive())) refuse('application-exited');
      const result = extractVerdict(await logs(), expected, pid);
      if (result) {
        if (!(await alive())) refuse('application-exited');
        const report = {
          ...result,
          pid,
          checkoutCommit: expected.checkoutCommit,
          runId: expected.runId,
          ...binding,
          platformEvidence,
        };
        await writeFile(output, JSON.stringify(report, null, 2) + '\n', {
          mode: 0o600,
          flag: 'wx',
        });
        console.log(JSON.stringify(report));
        return;
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 1000));
    }
    refuse('runtime-verdict-timeout');
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      if (collector) await collector.stop();
    } catch (cleanupError) {
      // Keep the first failure; a later cleanup failure must not replace it.
      if (!primary) throw cleanupError;
      console.log(JSON.stringify({ cleanupFailedAfterFailure: true }));
    }
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'prepare' && args.length === 2) return prepare(...args);
  if (['ios', 'android'].includes(command) && args.length === 4)
    return observe(command, ...args);
  refuse('invalid-probe-command');
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(error => {
    console.error(
      JSON.stringify({
        status: 'FAIL',
        code: error instanceof ProbeFailure ? error.message : 'runner-failed',
      }),
    );
    process.exitCode = 1;
  });
}
