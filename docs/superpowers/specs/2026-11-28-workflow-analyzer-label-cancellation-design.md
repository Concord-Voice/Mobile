# Keep workflow analysis running through unrelated labels

An unrelated label update cancels the current workflow analyzer, then its own analyzer job is skipped.

Put the per-PR concurrency group on the analyzer job. Retain its event and same-repository conditions and the existing fork notice behavior with its own per-PR concurrency group.

## Acceptance criteria

Run actionlint. After deployment, check the next eligible run can supersede an earlier analyzer and that an ordinary label leaves the eligible analyzer running.
