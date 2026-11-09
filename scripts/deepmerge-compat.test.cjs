const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const merge = require('deepmerge');

const hostile = () =>
  JSON.parse('{"__proto__":{"injected":true},"ordinary":1}');
const consumers = [
  '@react-native-community/cli',
  '@react-native-community/cli-config',
  '@react-native-community/cli-doctor',
  'jest-config',
];

for (const consumer of consumers) {
  test(`${consumer} resolves the patched implementation before lifecycle scripts`, () => {
    const fromConsumer = createRequire(require.resolve(consumer));
    assert.equal(fromConsumer('deepmerge'), merge);
    assert.equal(
      fromConsumer('deepmerge/package.json').name,
      '@concordvoice/deepmerge',
    );
    assert.equal(
      fromConsumer('deepmerge/package.json').version,
      '4.3.1-concord.1',
    );
  });
}

for (const [name, input] of [
  ['target copying', () => [hostile(), {}]],
  [
    'source into a null-prototype target',
    () => [Object.create(null), hostile()],
  ],
  [
    'recursive collision',
    () => [{ nested: hostile() }, { nested: { ok: true } }],
  ],
  ['array element cloning', () => [[hostile()], []]],
]) {
  test(`does not poison the returned prototype during ${name}`, () => {
    const [target, source] = input();
    const before = [JSON.stringify(target), JSON.stringify(source)];
    const result = merge(target, source);
    const value = result.nested || (Array.isArray(result) ? result[0] : result);
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
    assert.equal(value.injected, undefined);
    assert.equal({}.injected, undefined);
    assert.deepEqual([JSON.stringify(target), JSON.stringify(source)], before);
    if (Object.hasOwn(value, '__proto__')) {
      assert.deepEqual(Object.getOwnPropertyDescriptor(value, '__proto__'), {
        value: { injected: true },
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  });
}

test('preserves symbols, cloning, nulls, functions and custom merge options', () => {
  const symbol = Symbol('metadata');
  const callback = () => 'ok';
  const target = {
    items: [{ a: 1 }],
    nested: { a: 1 },
    callback,
    [symbol]: { a: 1 },
  };
  const source = {
    items: [{ b: 2 }],
    nested: { b: 2 },
    platform: null,
    [symbol]: { b: 2 },
  };
  const result = merge(target, source);
  assert.deepEqual(result.items, [{ a: 1 }, { b: 2 }]);
  assert.notEqual(result.items[0], target.items[0]);
  assert.deepEqual(result.nested, { a: 1, b: 2 });
  assert.deepEqual(result[symbol], { a: 1, b: 2 });
  assert.equal(result.platform, null);
  assert.equal(result.callback, callback);
  assert.equal(merge({}, { item: target }, { clone: false }).item, target);
  assert.deepEqual(
    merge(
      { value: { a: 1 } },
      { value: { b: 2 } },
      {
        customMerge: key => (key === 'value' ? (a, b) => [a, b] : undefined),
      },
    ),
    { value: [{ a: 1 }, { b: 2 }] },
  );
  assert.deepEqual(merge.all([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });
  assert.throws(() => merge.all({}), /first argument should be an array/);
});

test('preserves unsafe inherited/non-enumerable source-key refusal', () => {
  const target = Object.create({ inherited: { original: true } });
  Object.defineProperty(target, 'hidden', { value: { original: true } });
  const result = merge(target, {
    inherited: { injected: true },
    hidden: {},
    constructor: {},
    prototype: {},
  });
  assert.equal(Object.hasOwn(result, 'inherited'), false);
  assert.equal(Object.hasOwn(result, 'hidden'), false);
  assert.equal(Object.hasOwn(result, 'constructor'), false);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
});

const fromConfig = createRequire(
  require.resolve('@react-native-community/cli-config'),
);
const cliMerge = fromConfig('./merge').default;
test('actual CLI merge keeps source-array identity, empty replacements and nested fields', () => {
  const items = ['override'];
  const callback = () => 'ok';
  const result = cliMerge(
    { items: ['generated'], nested: { a: 1 }, callback },
    { items, nested: { b: 2 }, platform: null },
  );
  assert.equal(result.items, items);
  assert.deepEqual(result.nested, { a: 1, b: 2 });
  assert.equal(result.callback, callback);
  assert.equal(result.platform, null);
  const empty = [];
  assert.equal(cliMerge({ items }, { items: empty }).items, empty);
  assert.equal(cliMerge(hostile(), {}).injected, undefined);
});

async function withProject(check) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-deepmerge-'));
  try {
    await check(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('actual synchronous and asynchronous CLI loaders merge dependency configuration', async () => {
  await withProject(async root => {
    const dependency = path.join(root, 'fixture');
    fs.mkdirSync(dependency);
    fs.writeFileSync(
      path.join(dependency, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'fixture-app', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(root, 'react-native.config.js'),
      `module.exports = {
      reactNativePath: ${JSON.stringify(
        path.dirname(require.resolve('react-native/package.json')),
      )},
      dependencies: { fixture: { root: ${JSON.stringify(
        dependency,
      )}, platforms: { custom: { items: ['override'], nested: { b: 2 } } } } },
      platforms: { custom: { projectConfig: () => ({ name: 'fixture' }), dependencyConfig: () => ({ items: ['generated'], nested: { a: 1 }, callback: () => 'ok' }) } }
    };`,
    );
    const config = require('@react-native-community/cli-config');
    for (const loaded of [
      config.default({ projectRoot: root }),
      await config.loadConfigAsync({ projectRoot: root }),
    ]) {
      const platform = loaded.dependencies.fixture.platforms.custom;
      assert.deepEqual(platform.items, ['override']);
      assert.deepEqual(platform.nested, { a: 1, b: 2 });
      assert.equal(platform.callback(), 'ok');
      assert.equal(loaded.project.custom.name, 'fixture');
    }
  });
});

test('actual doctor builder concatenates checks without executing diagnostics or fixes', async () => {
  const configPath = require.resolve('@react-native-community/cli-config');
  const original = require.cache[configPath].exports;
  let executed = false;
  const diagnostic = () => {
    executed = true;
    throw new Error('must not execute');
  };
  const custom = {
    label: 'Fixture check',
    getDiagnostics: diagnostic,
    runAutomaticFix: diagnostic,
  };
  const checks = { custom: { label: 'Custom', healthchecks: [custom] } };
  require.cache[configPath].exports = {
    ...original,
    loadConfigAsync: async () => ({
      healthChecks: checks,
      reactNativePath: '/fixture',
    }),
  };
  try {
    const fromDoctor = createRequire(
      require.resolve('@react-native-community/cli-doctor'),
    );
    const { getHealthchecks } = fromDoctor('./tools/healthchecks');
    const result = await getHealthchecks({ contributor: false });
    assert.equal(result.custom.healthchecks[0].getDiagnostics, diagnostic);
    assert.equal(result.custom.healthchecks[0].runAutomaticFix, diagnostic);
    assert.ok(result.common.healthchecks.length >= 4);
    assert.ok(result.android.healthchecks.length >= 6);
    assert.equal(executed, false);
  } finally {
    require.cache[configPath].exports = original;
  }
});

for (const poisoned of [false, true]) {
  test(`actual Jest preset/project globals merge stays compatible (hostile=${poisoned})`, async () => {
    await withProject(async root => {
      const preset = path.join(root, 'preset');
      fs.mkdirSync(preset);
      const globals = poisoned
        ? hostile()
        : { nested: { preset: true }, items: [1] };
      fs.writeFileSync(
        path.join(preset, 'jest-preset.json'),
        JSON.stringify({ globals }),
      );
      const config = path.join(root, 'jest.config.json');
      fs.writeFileSync(
        config,
        JSON.stringify({
          rootDir: root,
          preset,
          globals: { project: true, nested: { project: true }, items: [2] },
          testEnvironment: require.resolve('jest-environment-node'),
          transform: {},
        }),
      );
      const result = (await require('jest-config').readConfig({ config }, root))
        .projectConfig.globals;
      assert.equal(result.project, true);
      assert.equal(result.injected, undefined);
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
      assert.equal({}.injected, undefined);
      if (!poisoned) {
        assert.deepEqual(result.nested, { preset: true, project: true });
        assert.deepEqual(result.items, [1, 2]);
      }
    });
  });
}
