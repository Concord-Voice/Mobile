const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const estree = require('@typescript-eslint/typescript-estree');

// Resolve from the real consumer, rather than assuming npm's hoisting layout.
const fromEstree = createRequire(
  require.resolve('@typescript-eslint/typescript-estree'),
);
const matcherPath = fromEstree.resolve('minimatch');

test('the named matcher preserves Windows paths and matching options', () => {
  const { minimatch } = fromEstree('minimatch');
  const options = { dot: true, platform: 'win32' };
  assert.equal(
    minimatch(path.win32.join('tools', '.config.ts'), 'tools/*.ts', options),
    true,
  );
  assert.equal(
    minimatch(path.win32.join('tools', 'config.js'), 'tools/*.ts', options),
    false,
  );
  assert.equal(
    minimatch(
      path.win32.join('tools', 'build.ts'),
      'tools/@(config|build).ts',
      options,
    ),
    true,
  );
});

function withProject(check) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-estree-'));
  const source = 'export const value: number = 1;';
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { noEmit: true },
      files: ['included.ts'],
    }),
  );
  fs.writeFileSync(path.join(root, 'included.ts'), source);
  estree.clearCaches();
  try {
    check((file, allowDefaultProject) => {
      const filePath = path.join(root, file);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, source);
      return estree.parseAndGenerateServices(source, {
        filePath,
        tsconfigRootDir: root,
        projectService: { allowDefaultProject },
      });
    });
  } finally {
    estree.clearCaches();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const [file, patterns] of [
  ['config.ts', ['*.ts']],
  ['.config.ts', ['*.ts']],
  ['tools/task.ts', ['tools/*.ts']],
  ['config.ts', ['{config,build}.ts']],
  ['build.ts', ['@(config|build).ts']],
]) {
  test(`project service matches ${file} with ${patterns[0]}`, () => {
    withProject(parse => {
      const result = parse(file, patterns);
      assert.equal(result.ast.type, 'Program');
      assert.ok(result.services.program);
    });
  });
}

for (const patterns of [undefined, [], ['other.ts']]) {
  test(`project service rejects an unlisted file (${JSON.stringify(
    patterns,
  )})`, () => {
    withProject(parse => {
      assert.throws(
        () => parse('config.ts', patterns),
        /not found by the project service/,
      );
    });
  });
}

test('project service preserves configured-project membership', () => {
  withProject(parse => {
    assert.ok(parse('included.ts', []).services.program);
  });
  withProject(parse => {
    assert.throws(
      () => parse('included.ts', ['included.ts']),
      /allowDefaultProject.*project service/s,
    );
  });
});

for (const pattern of ['*', '**/*.ts', '**/../x/'.repeat(20) + '*.ts']) {
  test(`project service rejects a broad glob (${pattern.slice(0, 24)})`, () => {
    withProject(parse => {
      assert.throws(
        () => parse('config.ts', [pattern]),
        /overly wide|disallowed '\*\*'/,
      );
    });
  });
}

test('the consumer matcher handles amplification patterns within a capped subprocess', () => {
  // The present caller uses optimization level 1 and rejects **. Exercise the
  // affected dependency's optional level 2 too, without risking the test runner.
  const child = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=128',
      '-e',
      `
      const assert = require('node:assert/strict');
      const {Minimatch, minimatch} = require(process.argv[1]);
      for (const optimizationLevel of [0, 1, 2]) {
        assert.equal(minimatch('.config.ts', '*.ts', {dot: true, optimizationLevel}), true);
        assert.equal(minimatch('config.js', '*.ts', {dot: true, optimizationLevel}), false);
        for (const part of ['**/../x/', '**//../x/']) {
          const pattern = 'a/' + part.repeat(20) + 'end';
          if (optimizationLevel === 2) {
            assert.throws(() => new Minimatch(pattern, {optimizationLevel}),
              {name: 'RangeError', message: /too many patterns/});
          } else {
            assert.equal(typeof new Minimatch(pattern, {optimizationLevel}).match('a/x/end'), 'boolean');
          }
        }
      }
    `,
      matcherPath,
    ],
    { timeout: 5000, encoding: 'utf8', maxBuffer: 32768 },
  );
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 0, child.stderr);
});
