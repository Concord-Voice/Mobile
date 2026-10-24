#!/usr/bin/env python3
"""Apply immutable exclusions without allowing PR ignore files to narrow coverage.

Run this helper from the validated workflow snapshot, never from the PR checkout.
Protected scans also pass --no-git-ignore and load rules from that snapshot.
"""
import argparse
import os
from pathlib import Path


def prepare(target: Path, policy: Path) -> None:
    ignore = policy / '.semgrepignore'
    if ignore.is_symlink() or not ignore.is_file():
        raise ValueError('Protected .semgrepignore must be a regular file')
    content = ignore.read_text()
    # Includes could read a PR-controlled file relative to the scan checkout.
    # Keep the immutable policy self-contained instead of resolving such files.
    if any(line.lstrip().startswith(':include') for line in content.splitlines()):
        raise ValueError('Protected exclusions must be self-contained (no :include)')
    # Never follow PR symlinks or descend into git metadata. Remove nested
    # policies too: newer Semgrep ignore engines can honor them independently.
    for directory, dirs, files in os.walk(target, followlinks=False):
        dirs[:] = [name for name in dirs if name != '.git']
        if '.semgrepignore' in dirs:
            raise ValueError('.semgrepignore must not be a directory')
        if '.semgrepignore' in files:
            (Path(directory) / '.semgrepignore').unlink()
    (target / '.semgrepignore').write_text(content)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', type=Path, required=True)
    parser.add_argument('--policy', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.target, args.policy)
