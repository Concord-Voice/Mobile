import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  writeFile,
  stat,
  symlink,
  utimes,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const sourceURL = new URL(
  '../patch-react-native-gradle-plugin.mjs',
  import.meta.url,
);
const catalogURL = new URL(
  './fixtures/react-native-gradle-libs.versions.toml',
  import.meta.url,
);
const oldLine = 'kotlin = "2.2.0"';
const newLine = 'kotlin = "2.4.21"';

async function project(t) {
  const root = await mkdtemp(join(tmpdir(), 'mobile-gradle-patch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rnDir = join(root, 'node_modules/react-native');
  const pluginDir = join(root, 'node_modules/@react-native/gradle-plugin');
  const scriptDir = join(root, 'scripts');
  await Promise.all([
    mkdir(rnDir, { recursive: true }),
    mkdir(join(pluginDir, 'gradle'), { recursive: true }),
    mkdir(scriptDir),
  ]);
  const catalog = join(pluginDir, 'gradle/libs.versions.toml');
  const rnPackage = join(rnDir, 'package.json');
  const pluginPackage = join(pluginDir, 'package.json');
  const script = join(scriptDir, 'patch-react-native-gradle-plugin.mjs');
  const pristine = await readFile(catalogURL);
  await Promise.all([
    writeFile(catalog, pristine),
    writeFile(
      rnPackage,
      JSON.stringify({ name: 'react-native', version: '0.88.0' }),
    ),
    writeFile(
      pluginPackage,
      JSON.stringify({
        name: '@react-native/gradle-plugin',
        version: '0.88.0',
      }),
    ),
    writeFile(script, await readFile(sourceURL)),
  ]);
  return { root, catalog, rnPackage, pluginPackage, script, pristine };
}

async function patcher(fixture) {
  // Import a copy into a disposable root: even a broken direct-invocation
  // detector cannot patch the real installed dependency during a test.
  const imported = await import(pathToFileURL(fixture.script).href);
  assert.equal(typeof imported.patchReactNativeGradlePlugin, 'function');
  return imported.patchReactNativeGradlePlugin;
}

function expectedBytes(pristine) {
  const text = pristine.toString('utf8');
  assert.equal(
    text.split(oldLine).length,
    2,
    'pristine upstream fixture contains exactly one Kotlin selection',
  );
  return Buffer.from(text.replace(oldLine, newLine));
}

// Read bytes and identity through one descriptor. Each call opens the path
// afresh, so the after snapshot also detects a renamed/replaced catalog.
async function catalogSnapshot(path) {
  const handle = await open(path, 'r');
  try {
    const bytes = await handle.readFile();
    const metadata = await handle.stat();
    return {
      bytes,
      dev: metadata.dev,
      ino: metadata.ino,
      mtimeMs: metadata.mtimeMs,
    };
  } finally {
    await handle.close();
  }
}

async function rejectUnchanged(fixture, patch, code) {
  const before = await catalogSnapshot(fixture.catalog);
  await assert.rejects(patch(fixture.root), { message: code });
  const after = await catalogSnapshot(fixture.catalog);
  assert.deepEqual(after.bytes, before.bytes);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
}

test('patch preserves every catalog byte except the one approved Kotlin version', async t => {
  const fixture = await project(t);
  const patch = await patcher(fixture);
  assert.deepEqual(
    await readFile(fixture.catalog),
    fixture.pristine,
    'import itself must not patch',
  );
  assert.equal(await patch(fixture.root), 'patched');
  assert.deepEqual(
    await readFile(fixture.catalog),
    expectedBytes(fixture.pristine),
  );
  assert.deepEqual(JSON.parse(await readFile(fixture.rnPackage, 'utf8')), {
    name: 'react-native',
    version: '0.88.0',
  });
  assert.deepEqual(JSON.parse(await readFile(fixture.pluginPackage, 'utf8')), {
    name: '@react-native/gradle-plugin',
    version: '0.88.0',
  });
});

test('known patched bytes are idempotent without rewriting or replacing the file', async t => {
  const fixture = await project(t);
  const patch = await patcher(fixture);
  const patched = expectedBytes(fixture.pristine);
  await writeFile(fixture.catalog, patched);
  // A fixed old timestamp distinguishes no-write from a same-content rewrite.
  await utimes(
    fixture.catalog,
    new Date('2000-01-01T00:00:00Z'),
    new Date('2000-01-01T00:00:00Z'),
  );
  const before = await catalogSnapshot(fixture.catalog);
  assert.deepEqual(before.bytes, patched);
  assert.equal(await patch(fixture.root), 'already-patched');
  assert.equal(await patch(fixture.root), 'already-patched');
  const after = await catalogSnapshot(fixture.catalog);
  assert.deepEqual(after.bytes, patched);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test('both exact installed package identities are checked even for an already-patched catalog', async t => {
  for (const patched of [false, true]) {
    for (const target of ['rnPackage', 'pluginPackage']) {
      for (const field of ['name', 'version']) {
        await t.test(
          `${patched ? 'patched' : 'pristine'}/${target}/${field}`,
          async t => {
            const fixture = await project(t);
            const patch = await patcher(fixture);
            if (patched)
              await writeFile(fixture.catalog, expectedBytes(fixture.pristine));
            const manifest = JSON.parse(
              await readFile(fixture[target], 'utf8'),
            );
            manifest[field] = field === 'name' ? 'different-package' : '0.88.1';
            await writeFile(fixture[target], JSON.stringify(manifest));
            await rejectUnchanged(
              fixture,
              patch,
              target === 'rnPackage'
                ? 'unsupported-react-native-package'
                : 'unsupported-react-native-gradle-plugin-package',
            );
          },
        );
      }
    }
  }
});

test('unreviewed catalog drift refuses including files already advertising the desired version', async t => {
  for (const mutation of [
    pristine =>
      Buffer.from(`${pristine.toString('utf8')}\n# unrelated drift\n`),
    pristine =>
      Buffer.from(
        `${expectedBytes(pristine).toString('utf8')}\n# unrelated drift\n`,
      ),
    pristine =>
      Buffer.from(pristine.toString('utf8').replace('2.2.0', '2.3.0')),
    pristine =>
      Buffer.from(
        pristine
          .toString('utf8')
          .replace('guava = "31.0.1-jre"', 'guava = "31.0.2-jre"'),
      ),
  ]) {
    const fixture = await project(t);
    const patch = await patcher(fixture);
    await writeFile(fixture.catalog, mutation(fixture.pristine));
    await rejectUnchanged(
      fixture,
      patch,
      'unsupported-react-native-gradle-catalog',
    );
  }
});

test('missing or malformed inputs refuse before any catalog write', async t => {
  for (const target of ['rnPackage', 'pluginPackage']) {
    for (const kind of ['missing', 'invalid JSON']) {
      await t.test(`${target}/${kind}`, async t => {
        const fixture = await project(t);
        const patch = await patcher(fixture);
        if (kind === 'missing') await rm(fixture[target]);
        else await writeFile(fixture[target], '{not-json');
        await rejectUnchanged(
          fixture,
          patch,
          'react-native-gradle-patch-input-unavailable',
        );
      });
    }
  }
  await t.test('missing catalog', async t => {
    const fixture = await project(t);
    const patch = await patcher(fixture);
    await rm(fixture.catalog);
    await assert.rejects(patch(fixture.root), {
      message: 'react-native-gradle-patch-input-unavailable',
    });
    await assert.rejects(stat(fixture.catalog), { code: 'ENOENT' });
  });
});

test('import is side-effect free without any installed packages', async t => {
  const fixture = await project(t);
  await rm(join(fixture.root, 'node_modules'), { recursive: true });
  await patcher(fixture);
  await assert.rejects(stat(join(fixture.root, 'node_modules')), {
    code: 'ENOENT',
  });
});

test('direct CLI uses its own repository root from an unrelated cwd and rejects path arguments', async t => {
  const fixture = await project(t);
  const unrelated = await project(t);
  await exec(process.execPath, [fixture.script], { cwd: unrelated.root });
  assert.deepEqual(
    await readFile(fixture.catalog),
    expectedBytes(fixture.pristine),
  );
  assert.deepEqual(await readFile(unrelated.catalog), unrelated.pristine);
  await assert.rejects(
    exec(process.execPath, [fixture.script, unrelated.root], {
      cwd: unrelated.root,
    }),
    error => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /unexpected-arguments/);
      return true;
    },
  );
  assert.deepEqual(await readFile(unrelated.catalog), unrelated.pristine);
});

// Reproduce macOS /var -> /private/var path identity on Linux too: Node resolves
// the module file, while argv still names the same script through its parent alias.
test('direct CLI through a symlinked parent patches its owner and rejects path arguments', async t => {
  const fixture = await project(t);
  const unrelated = await project(t);
  const alias = join(unrelated.root, 'script-owner-alias');
  await symlink(fixture.root, alias, 'dir');
  const aliasedScript = join(alias, 'scripts/patch-react-native-gradle-plugin.mjs');
  await exec(process.execPath, [aliasedScript], { cwd: unrelated.root });
  assert.deepEqual(
    await readFile(fixture.catalog),
    expectedBytes(fixture.pristine),
  );
  assert.deepEqual(await readFile(unrelated.catalog), unrelated.pristine);
  await assert.rejects(
    exec(process.execPath, [aliasedScript, unrelated.root], {
      cwd: unrelated.root,
    }),
    error => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /unexpected-arguments/);
      return true;
    },
  );
  assert.deepEqual(await readFile(unrelated.catalog), unrelated.pristine);
});
