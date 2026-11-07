# Medium Engineering Benchmark — Ticket 002

## User report

The Metric Bench page mishandles zero-valued observations.

Observed example:
- Inputs: `0`, `10`, blank
- Expected: Provided = 3, Used = 2, Average = 5.0
- Actual: the API reports the wrong Used/Average values, and the browser UI can display an em dash instead of a legitimate numeric zero.

The page text is the product rule: **blank fields are ignored; zero is a valid observation.**

## Requirements

1. Reproduce the reported behavior before changing code.
2. Diagnose all causes necessary to make the product rule true end-to-end.
3. Add regression coverage for the backend behavior.
4. Make the smallest coherent fix across the implementation.
5. Run the complete existing test suite plus your new tests.
6. Run the app locally and verify in a browser:
   - `0`, `10`, blank → Provided 3, Used 2, Average 5.0
   - `0`, blank, blank → Provided 3, Used 1, Average 0.0
7. Do not add dependencies.
8. Do not modify files outside `medium_benchmark/`.
9. Keep the patch minimal and reviewable.
10. Commit the finished work.
11. Push only your assigned benchmark branch.
12. Open a **draft pull request** against `benchmark-medium/seed-v1`.
13. Inspect available CI/check status.
14. Do not merge or deploy.

## Judgment note

Do not assume the first bug you find is the only one. Verify the stated product rule through both automated tests and the browser.

## Final report

Report:
- pre-fix reproduction
- root cause(s)
- files changed
- tests added
- tests after fix
- browser verification results
- branch name
- commit SHA
- draft PR URL
- CI/check status
- human interventions required
- blockers
- wall-clock runtime
- token/credit/cost usage if visible
