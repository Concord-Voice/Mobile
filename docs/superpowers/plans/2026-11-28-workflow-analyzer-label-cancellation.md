# Keep workflow analysis running through unrelated labels implementation plan

1. Confirm the affected source contract on the current default branch.
2. Put the per-PR concurrency group on the analyzer job. Retain its event and same-repository conditions and the existing fork notice behavior.
3. Run actionlint. Check the next eligible run can supersede an earlier analyzer and that an ordinary label leaves the eligible analyzer running.
4. Run the applicable independent reviews and required CI. Request merge approval for the reviewed head.
