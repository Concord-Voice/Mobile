"""Exercise the extracted workflow's selection step at its process boundary."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = yaml.load((ROOT / '.github/workflows/pr-ci.yml').read_text(), Loader=yaml.BaseLoader)


class MobileScannerContract(unittest.TestCase):
    def select(self, value):
        job = WORKFLOW['jobs']['detect-changes']
        step = next(s for s in job['steps'] if s.get('id') == 'mobile-selection')
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'output'
            run = subprocess.run(['bash', '-e', '-c', step['run']], check=False,
                                 env={**os.environ, 'SELECTION': json.dumps(value), 'GITHUB_OUTPUT': str(output)},
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            return dict(line.split('=', 1) for line in output.read_text().splitlines())

    def test_scanner_selection_preserves_identity_and_omits_absent_products(self):
        original = {'known': True, 'policy_sha': 'a' * 40, 'head_sha': 'b' * 40,
                    'selected': dict.fromkeys(['eslint', 'osv', 'semgrep_custom', 'semgrep_community',
                                              'semgrep_canary', 'sonar', 'govulncheck'], True),
                    'coverage_required': {'desktop': True, 'admin': True}}
        result = self.select(original)
        self.assertEqual(result['known'], 'true')
        selection = json.loads(result['selection'])
        self.assertEqual(selection['policy_sha'], original['policy_sha'])
        self.assertEqual(selection['head_sha'], original['head_sha'])
        self.assertFalse(selection['selected']['sonar'])
        self.assertFalse(selection['selected']['govulncheck'])
        self.assertTrue(selection['selected']['eslint'])
        self.assertTrue(selection['selected']['osv'])
        self.assertFalse(any(selection['coverage_required'].values()))

    def test_unknown_policy_never_becomes_valid_selection(self):
        result = self.select({'known': False})
        self.assertEqual(result['known'], 'false')
        self.assertIs(json.loads(result['selection'])['known'], False)

    def test_installing_jobs_depend_on_ioc_and_no_app_build_is_fabricated(self):
        for name in ('semgrep', 'eslint', 'secret-scanning', 'workflow-lint', 'app-checks'):
            self.assertIn('ioc', WORKFLOW['jobs'][name]['needs'], name)
        app = WORKFLOW['jobs']['app-checks']
        self.assertEqual([step['run'] for step in app['steps'] if 'run' in step],
                         ['npm ci', 'npm test', 'npm run lint', 'npm run typecheck'])
        self.assertEqual(app['permissions'], {'contents': 'read'})
        self.assertNotIn('build', WORKFLOW['jobs'])
        report = next(s for s in WORKFLOW['jobs']['report']['steps'] if s.get('id') == 'report')
        self.assertIn("'ioc': os.environ['IOC_RESULT']", report['run'])
        self.assertNotIn("'build':", report['run'])
        self.assertNotIn('SONAR_TOKEN', json.dumps(WORKFLOW))

    def test_default_branch_scanners_run_after_ioc(self):
        baseline = yaml.load((ROOT / '.github/workflows/scanner-baseline.yml').read_text(),
                             Loader=yaml.BaseLoader)
        self.assertEqual(baseline['on']['push']['branches'], ['main'])
        self.assertTrue(baseline['on']['schedule'][0]['cron'])
        self.assertEqual(baseline['concurrency']['cancel-in-progress'], 'false')
        for name in ('codeql', 'scorecard'):
            job = baseline['jobs'][name]
            self.assertEqual(job['needs'], ['ioc'])
            self.assertNotIn('if', job, 'IOC failure must use the default skip behavior')
            self.assertEqual(job['uses'], f'./.github/workflows/{name}.yml')
        self.assertNotIn('secrets', json.dumps(baseline))

    def test_protected_owner_requires_mobile_repository_and_main(self):
        step = next(s for s in WORKFLOW['jobs']['detect-changes']['steps']
                    if s.get('id') == 'protected-owner')
        cases = [
            ({'repository_id': 1359565586, 'ref': 'main'}, True),
            ({'repository_id': 1359565586, 'ref': 'refs/heads/main'}, True),
            ({'repository_id': 1158152129, 'ref': 'main'}, False),
            ({'repository_id': 1359565586, 'ref': 'refs/tags/main'}, False),
            ({'repository_id': 1359565586, 'ref': 'main', 'sha': 'a' * 40}, False),
        ]
        for rule, expected in cases:
            with self.subTest(rule=rule), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                output = directory / 'output'
                rule['path'] = '.github/workflows/required-pr-build.yml'
                (directory / 'rules.json').write_text(json.dumps([
                    {'type': 'workflows', 'parameters': {'workflows': [rule]}}]))
                gh = directory / 'gh'
                gh.write_text('#!/bin/sh\ncat "$RUNNER_TEMP/rules.json"\n')
                gh.chmod(0o755)
                run = subprocess.run(['bash', '-e', '-c', step['run']], check=False,
                                     env={**os.environ, 'PATH': temp + os.pathsep + os.environ['PATH'],
                                          'RUNNER_TEMP': temp, 'GITHUB_OUTPUT': str(output),
                                          'GITHUB_REPOSITORY': 'Concord-Voice/Mobile',
                                          'MODE': 'required-full',
                                          'SELECTION': json.dumps({'known': True, 'hotfix': False,
                                                                   'mode': 'required-full'})},
                                     capture_output=True, text=True)
                self.assertEqual(run.returncode, 0, run.stderr)
                values = dict(line.split('=', 1) for line in output.read_text().splitlines())
                self.assertEqual(values['confirmed'], str(expected).lower())


if __name__ == '__main__':
    unittest.main()
