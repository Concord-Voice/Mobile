"""Run scripts/security/reject-package-manager-config.sh against fixture repos."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
GUARD = ROOT / 'scripts/security/reject-package-manager-config.sh'
ALLOWED = ['package.json', 'vendor/deepmerge/package.json',
           '.github/tools/eslint-formatter/package.json', '.github/tools/license-checker/package.json']


def git(repo, *args, **kw):
    return subprocess.run(['git', '-C', repo, *args], check=True, capture_output=True, **kw)


class RejectPackageManagerConfig(unittest.TestCase):
    def run_guard(self, offenders=(), symlink=None, cwd=''):
        """Index the allowed files plus offenders (bytes paths) and run the guard."""
        with tempfile.TemporaryDirectory() as repo:
            git(repo, 'init', '-q')
            blob = git(repo, 'hash-object', '-w', '--stdin', input=b'{}').stdout.strip()
            entries = [b'100644 %s\t%s\0' % (blob, p.encode()) for p in ALLOWED]
            entries += [b'100644 %s\t%s\0' % (blob, p) for p in offenders]
            if symlink:
                target = git(repo, 'hash-object', '-w', '--stdin', input=b'elsewhere').stdout.strip()
                entries.append(b'120000 %s\t%s\0' % (target, symlink))
            git(repo, 'update-index', '-z', '--index-info', input=b''.join(entries))
            workdir = Path(repo, cwd)
            workdir.mkdir(parents=True, exist_ok=True)
            run = subprocess.run(['bash', str(GUARD)], cwd=workdir, capture_output=True,
                                 env={**os.environ, 'LC_ALL': 'en_US.UTF-8'})
            paths = [line[len(b'path: '):] for line in run.stdout.splitlines() if line.startswith(b'path: ')]
            return run.returncode, run.stdout, paths

    def test_clean_tree_passes(self):
        rc, out, paths = self.run_guard([b'README.md', b'.npmrc.bak', b'ok/package.json.bak'])
        self.assertEqual((rc, paths), (0, []), out)

    def test_each_offender_fails_and_is_listed(self):
        for name in [b'.npmrc', b'.NPMRC', b'a/b/.yarnrc.yml', b'a/.YarnRC', b'npm-shrinkwrap.json',
                     b'NPM-Shrinkwrap.JSON', b'scripts/node_modules/deepmerge/index.js',
                     b'x/Node_Modules/p/i.js', b'scripts/node_modules', b'scripts/package.json',
                     b'PACKAGE.JSON', b'Vendor/deepmerge/package.json',
                     'scripts/package.jſon'.encode(), 'npm-shrinKwrap.json'.encode(),
                     'src/node_moduleſ/x.js'.encode(), b'bad\xff/.npmrc']:
            with self.subTest(name=name):
                rc, out, paths = self.run_guard([name])
                self.assertEqual(rc, 1, out)
                self.assertEqual(paths, [name])
                self.assertEqual(out.count(b'::error::'), 1)

    def test_symlink_fails(self):
        rc, out, paths = self.run_guard(symlink=b'scripts/anylink')
        self.assertEqual((rc, paths), (1, [b'scripts/anylink']), out)

    def test_runs_from_a_subdirectory(self):
        rc, out, paths = self.run_guard([b'.npmrc'], cwd='vendor/deepmerge')
        self.assertEqual((rc, paths), (1, [b'.npmrc']), out)

    def test_newline_or_cr_in_a_name_cannot_start_a_workflow_command(self):
        for sep in (b'\n', b'\r'):
            with self.subTest(sep=sep):
                rc, out, _ = self.run_guard([b'evil' + sep + b'::error title=pwn::x/.npmrc'])
                self.assertEqual(rc, 1, out)
                lines = out.replace(b'\r', b'\n').splitlines()
                self.assertEqual([l for l in lines if l.startswith(b'::')], [lines[0]])
                self.assertTrue(lines[0].startswith(b'::error::Tracked npm'))


if __name__ == '__main__':
    unittest.main()
