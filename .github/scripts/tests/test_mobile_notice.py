"""The npm NOTICE update must preserve independently reviewed native notices."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('mobile_notice', ROOT / 'scripts/update-mobile-notice.py')
NOTICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NOTICE)


class MobileNoticeTests(unittest.TestCase):
    def test_replaces_npm_attribution_without_removing_native_licenses(self):
        original = '# Notices\n' + NOTICE.START + '\nobsolete npm row\n' + NOTICE.END + '\nArgon2: Apache-2.0 OR CC0-1.0\n'
        row = '| react | 19.2.3 | MIT | https://github.com/facebook/react |'
        updated = NOTICE.render(original, [row])
        self.assertIn(row, updated)
        self.assertNotIn('obsolete npm row', updated)
        self.assertTrue(updated.endswith('\nArgon2: Apache-2.0 OR CC0-1.0\n'))
        self.assertTrue(updated.startswith('# Notices\n'))

    def test_ambiguous_or_missing_sections_refuse(self):
        for original in ('# Notices', NOTICE.START + NOTICE.START + NOTICE.END,
                         NOTICE.START + NOTICE.END + NOTICE.END, NOTICE.END + NOTICE.START):
            with self.subTest(original=original), self.assertRaises(ValueError):
                NOTICE.render(original, [])


if __name__ == '__main__':
    unittest.main()
