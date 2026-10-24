#!/usr/bin/env python3
"""Use Alpha's locked npm license reader for the standalone app's NOTICE table."""
import argparse
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START = '<!-- mobile-npm:start -->'
END = '<!-- mobile-npm:end -->'


def render(text, rows):
    if text.count(START) != 1 or text.count(END) != 1:
        raise ValueError('NOTICE must have exactly one npm section')
    before, rest = text.split(START)
    _, after = rest.split(END)
    table = '\n\n| Package | Version | License | Repository |\n| --- | --- | --- | --- |\n'
    return before + START + table + '\n'.join(rows) + '\n\n' + END + after


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('alpha_notice', ROOT / 'scripts/update-notice-md.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    path = ROOT / 'NOTICE.md'
    original = path.read_text()
    updated = render(original, module.npm_rows('.'))
    if args.check:
        if original != updated:
            raise SystemExit('NOTICE npm attribution table differs from installed production dependencies')
        print('Mobile npm NOTICE table is current')
    else:
        path.write_text(updated)


if __name__ == '__main__':
    main()
