"""The Mobile Sonar SBOM covers the locked Android runtime and CI pins."""

import importlib.util
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "mobile-sca-sbom.py"
SPEC = importlib.util.spec_from_file_location("mobile_sca_sbom", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class MobileScaSbomTests(unittest.TestCase):
    def test_locked_runtime_and_explicit_pins_are_exported(self):
        purls = {item["purl"] for item in MODULE.components()}
        lock = MODULE.ROOT / "android/app/gradle.lockfile"
        locked = {f"pkg:maven/{group}/{artifact}@{version}"
                  for line in lock.read_text().splitlines() if line and not line.startswith("#")
                  and line != "empty=" for group, artifact, version in [line.split("=", 1)[0].split(":")]}
        self.assertEqual(purls, locked | {
            "pkg:maven/junit/junit@4.13.2",
            "pkg:maven/androidx.test/runner@1.7.0",
            "pkg:maven/androidx.test.ext/junit@1.3.0",
            "pkg:pypi/pyyaml@6.0.3",
        })

    def test_malformed_lock_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "android/app").mkdir(parents=True)
            (root / "android/app/gradle.lockfile").write_text("unexpected dependency\n")
            old_root = MODULE.ROOT
            try:
                MODULE.ROOT = root
                with self.assertRaisesRegex(ValueError, "unsupported Gradle lock entry"):
                    MODULE.components()
            finally:
                MODULE.ROOT = old_root

    def test_new_native_dependency_shape_fails_closed(self):
        for declaration in ('api("a:b:1")', "testImplementation 'junit:junit:4.13.2'",
                            'testImplementation ("junit:junit:4.13.2")'):
            with self.subTest(declaration=declaration), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "android/app").mkdir(parents=True)
                (root / "native/ConcordCrypto/android").mkdir(parents=True)
                (root / "android/app/gradle.lockfile").write_text("a:b:1=releaseRuntimeClasspath\n")
                (root / "native/ConcordCrypto/android/build.gradle").write_text(declaration + "\n")
                old_root = MODULE.ROOT
                try:
                    MODULE.ROOT = root
                    with self.assertRaisesRegex(ValueError, "unsupported native Gradle dependency"):
                        MODULE.components()
                finally:
                    MODULE.ROOT = old_root


if __name__ == "__main__":
    unittest.main()
