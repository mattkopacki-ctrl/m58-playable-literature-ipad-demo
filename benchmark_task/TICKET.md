# Worker Efficiency Benchmark — Ticket 001

## Bug report

A caller reported that zero-valued observations are being ignored when calculating the average.

Example:

```python
summarize([0, 10])
```

Expected:

```python
{"count": 2, "average": 5.0}
```

The current implementation returns an inconsistent result.

## Requirements

1. Reproduce the bug before changing code.
2. Fix the defect without changing the public function names or return shape.
3. Add at least one regression test that would have caught the bug.
4. Run the complete existing test suite after the fix.
5. Do not add dependencies.
6. Do not modify files outside `benchmark_task/`.
7. Keep the patch minimal and reviewable.
8. Commit the finished work.
9. Push only your assigned benchmark branch.
10. Open a **draft pull request** against `benchmark/seed-v1`.
11. Inspect any available CI/check status and report it.
12. Do not merge or deploy.

## Final report

Report:
- tests before fix
- root cause
- files changed
- tests after fix
- branch name
- commit SHA
- draft PR URL
- CI/check status
- human interventions required
- any blocker
- task/runtime/credit usage if visible
