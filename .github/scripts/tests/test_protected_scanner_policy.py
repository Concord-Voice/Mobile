"""Adversarial coverage tests for protected scanner policy (no registry rules)."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import shlex
import zipfile
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('policy', ROOT / '.github/scripts/prepare-protected-semgrep.py')
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)
WORKFLOW = yaml.load((ROOT / '.github/workflows/semgrep.yml').read_text(), Loader=yaml.BaseLoader)
RULE = '''rules:
- id: regression-dangerous-call
  languages: [javascript]
  severity: ERROR
  message: dangerous call
  pattern: dangerous($X)
'''


class ProtectedPolicy(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.target = self.base / 'target'
        self.target.mkdir()
        self.policy = self.base / 'policy'
        self.policy.mkdir()
        (self.policy / '.semgrepignore').write_text('.semgrep/tests/\n')
        (self.policy / '.semgrep').mkdir()
        (self.policy / '.semgrep/rules.yml').write_text(RULE)
        self.env = {**os.environ, 'SEMGREP_SETTINGS_FILE': str(self.base / 'settings.yml'),
                    'SEMGREP_LOG_FILE': str(self.base / 'semgrep.log'), 'SEMGREP_SEND_METRICS': 'off', 'SEMGREP_ENABLE_VERSION_CHECK': '0',
                    'TRUSTED_SOURCE': 'true', 'SEMGREP_CUSTOM_RULES': str(self.policy / '.semgrep')}
        self.git('init', '-q')
        self.git('config', 'user.name', 'Scanner test')
        self.git('config', 'user.email', 'scanner@example.com')
        (self.target / 'README').write_text('baseline\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'baseline')
        self.env['BASELINE_COMMIT'] = self.git('rev-parse', 'HEAD').stdout.strip()

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.target, check=True, capture_output=True, text=True)

    def test_nested_and_symlink_ignores_cannot_survive(self):
        (self.target / 'src').mkdir()
        outside = self.base / 'outside'
        outside.write_text('leave unchanged')
        (self.target / '.semgrepignore').symlink_to(outside)
        (self.target / 'src/.semgrepignore').write_text('*\n')
        POLICY.prepare(self.target, self.policy)
        self.assertEqual(outside.read_text(), 'leave unchanged')
        self.assertEqual((self.target / '.semgrepignore').read_text(), '.semgrep/tests/\n')
        self.assertFalse((self.target / 'src/.semgrepignore').exists())

    def test_policy_includes_fail_closed(self):
        (self.policy / '.semgrepignore').write_text(':include attacker-policy\n')
        with self.assertRaises(ValueError):
            POLICY.prepare(self.target, self.policy)

    def test_directory_instead_of_ignore_fails_closed(self):
        (self.target / '.semgrepignore').mkdir()
        with self.assertRaises(ValueError):
            POLICY.prepare(self.target, self.policy)

    def test_workflow_identity_rejects_wrong_repo_sha_and_untrusted_verdict(self):
        step = WORKFLOW['jobs']['semgrep']['steps'][0]
        for trusted, repo, sha, ok in [('true', 'Concord-Voice/Mobile', 'a'*40, True),
                                     ('false', 'Concord-Voice/Mobile', 'a'*40, False),
                                     ('true', 'attacker/repo', 'a'*40, False),
                                     ('true', 'Concord-Voice/Mobile', 'main', False)]:
            with self.subTest(trusted=trusted, repo=repo, sha=sha):
                result = subprocess.run(['bash', '-e', '-c', step['run']], env={**self.env,
                    'TRUSTED_SOURCE': trusted, 'WORKFLOW_REPOSITORY': repo, 'WORKFLOW_SHA': sha})
                self.assertEqual(result.returncode == 0, ok)

    def test_trusted_canary_rejects_repo_relative_fixture_leakage(self):
        step = next(s for s in WORKFLOW['jobs']['semgrep']['steps'] if s.get('id') == 'canary')
        program = step['run'].split("python3 <<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]
        fixture = self.policy / 'trusted-canary.yml'
        fixture.write_text((ROOT / '.semgrep/tests/action-ref-canary.test.yaml').read_text())
        rule = 'yaml.github-actions.security.github-actions-mutable-action-tag.github-actions-mutable-action-tag'
        lines = fixture.read_text().splitlines()
        hits = [{'check_id': rule, 'start': {'line': n}, 'extra': {'severity': 'WARNING'}}
                for n, line in enumerate(lines, 1) if 'uses:' in line
                and not any(safe in line for safe in ('3d3c42e5aac5ba805825da76410c181273ba90b1', './.github/actions/'))]
        (self.target / 'semgrep-canary.json').write_text(json.dumps({'results': hits}))
        for leak in (False, True):
            result = {'results': [{'path': '.semgrep/tests/action-ref-canary.test.yaml'}] if leak else []}
            (self.target / 'semgrep-community.json').write_text(json.dumps(result))
            run = subprocess.run(['python3', '-c', program], cwd=self.target,
                                 env={**self.env, 'CANARY_FIXTURE': str(fixture)}, capture_output=True, text=True)
            self.assertEqual(run.returncode, 1 if leak else 0, run.stdout + run.stderr)
            if leak:
                self.assertIn('fixture leaked', run.stdout)

    def test_osv_scans_gitignored_lockfiles_with_real_pinned_engine(self):
        workflow = yaml.load((ROOT / '.github/workflows/osv-scanner.yml').read_text(), Loader=yaml.BaseLoader)
        scans = [step['run'] for job in workflow['jobs'].values() for step in job.get('steps', [])
                 if step.get('name') in ('Scan base dependencies', 'Scan test-merge dependencies')]
        self.assertEqual(len(scans), 2)
        db = self.base / 'db'
        npm = db / 'osv-scalibr/npm'
        npm.mkdir(parents=True)
        advisory = {'schema_version': '1.6.0', 'id': 'TEST-2026-0001',
                    'modified': '2026-01-01T00:00:00Z', 'published': '2026-01-01T00:00:00Z',
                    'summary': 'Synthetic regression fixture',
                    'affected': [{'package': {'ecosystem': 'npm', 'name': 'lodash'}, 'versions': ['4.17.20']}]}
        with zipfile.ZipFile(npm / 'all.zip', 'w') as archive:
            archive.writestr('TEST-2026-0001.json', json.dumps(advisory))
        results = self.base / 'results'
        results.mkdir()
        (results / 'config.toml').write_text('# Immutable empty config\n')
        for path, name, version in [('src', 'lodash', '4.17.20'), ('other', 'is-number', '7.0.0')]:
            (self.target / path).mkdir()
            lock = {'name': 'scanner-test', 'lockfileVersion': 3, 'packages': {
                '': {'name': 'scanner-test', 'dependencies': {name: version}},
                'node_modules/' + name: {'name': name, 'version': version}}}
            (self.target / path / 'package-lock.json').write_text(json.dumps(lock))
        self.git('add', '.')
        self.git('commit', '-qm', 'tracked lockfiles')
        for ignore in (self.target / '.gitignore', self.target / 'src/.gitignore'):
            ignore.write_text('**/package-lock.json\n' if ignore.parent == self.target else 'package-lock.json\n')
            # Keep a second manifest visible so omission still yields a valid scan.
            if ignore.parent == self.target:
                ignore.write_text('src/package-lock.json\n')
            for script in scans:
                image = next(line.strip().rstrip(' \\') for line in script.splitlines()
                             if 'ghcr.io/google/osv-scanner@' in line)
                args = shlex.split(next(line.strip() for line in script.splitlines() if line.strip().startswith('scan ')))
                output = next(a.split('=', 1)[1] for a in args if a.startswith('--output='))
                for protected in (False, True):
                    selected = args if protected else [a for a in args if a != '--no-ignore']
                    command = ['docker', 'run', '--rm', '--network', 'none',
                               '--user', f'{os.getuid()}:{os.getgid()}',
                               '-e', 'OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=/db',
                               '-v', f'{db}:/db', '-v', f'{results}:/results',
                               '-v', f'{self.target}:/github/workspace:ro', '-w', '/github/workspace',
                               image, *selected, '--offline', '--all-packages']
                    run = subprocess.run(command, capture_output=True, text=True, timeout=90)
                    self.assertEqual(run.returncode, 1 if protected else 0, run.stderr)
                    report = json.loads((results / Path(output).name).read_text())
                    found = 'TEST-2026-0001' in json.dumps(report)
                    self.assertEqual(found, protected, report)
            ignore.unlink()

    def test_real_engine_detects_ignored_code_with_modified_pr_rules(self):
        engine = os.environ.get('SEMGREP_BIN') or shutil.which('semgrep')
        self.assertTrue(engine, 'Install the workflow-pinned Semgrep before running this regression')
        (self.target / 'src').mkdir()
        (self.target / 'src/vulnerable.js').write_text('dangerous(userInput); // nosemgrep\n')
        (self.target / '.gitignore').write_text('src/\n')
        (self.target / '.semgrepignore').write_text('src/\n')
        (self.target / 'src/.gitignore').write_text('*.js\n')
        (self.target / 'src/.semgrepignore').write_text('*.js\n')
        (self.target / '.semgrep/tests').mkdir(parents=True)
        (self.target / '.semgrep/rules.yml').write_text(RULE.replace('dangerous($X)', 'benign($X)'))
        (self.target / '.semgrep/tests/canary.js').write_text('dangerous(canary);\n')
        self.git('add', '-f', '.')
        self.git('commit', '-qm', 'PR with malicious exclusions and policy')
        # Control: the old command silently omits the vulnerable production file.
        control = subprocess.run([engine, 'scan', '--config=.semgrep/rules.yml', '--json', '.'],
                                 cwd=self.target, env=self.env, capture_output=True, text=True)
        self.assertEqual(control.returncode, 0, control.stderr)
        self.assertEqual(json.loads(control.stdout)['results'], [])
        POLICY.prepare(self.target, self.policy)
        # Execute the actual workflow commands; replace registry downloads with
        # our local deterministic rule so this tests enumeration, not network uptime.
        bin_dir = self.base / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'semgrep').symlink_to(engine)
        env = {**self.env, 'PATH': str(bin_dir) + os.pathsep + os.environ['PATH']}
        for step_id in ('custom', 'community'):
            step = next(s for s in WORKFLOW['jobs']['semgrep']['steps'] if s.get('id') == step_id)
            command = step['run'].split('SCAN_EXIT=$?')[0]
            command = command.replace('--config=p/security-audit --config=p/owasp-top-ten',
                                      '--config="$SEMGREP_CUSTOM_RULES"')
            result = subprocess.run(['bash', '-e', '-c', command], cwd=self.target, env=env,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((self.target / f'semgrep-{step_id}.json').read_text())
            self.assertFalse(report['errors'], report['errors'])
            paths = {r['path'] for r in report['results']}
            self.assertIn('src/vulnerable.js', paths, report)
            self.assertNotIn('.semgrep/tests/canary.js', paths)
        # Explicit trusted canary still runs independently of directory exclusions.
        canary = self.policy / 'canary.js'
        canary.write_text('dangerous(canary);\n')
        result = subprocess.run([engine, 'scan', '--config', str(self.policy / '.semgrep'),
                                 '--json', str(canary)], cwd=self.target, env=env,
                                capture_output=True, text=True)
        self.assertEqual(len(json.loads(result.stdout)['results']), 1, result.stderr)


if __name__ == '__main__':
    unittest.main()
