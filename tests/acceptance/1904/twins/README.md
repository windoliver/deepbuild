# Twins for the 1904 tests

Ten `#1904.b57b5ae4` tests and the `#1904.9f3f4bff` test fail on the base at their assertions (`../BASE-FAILURE.txt`).
The archive's two pass there, since #1775 bounded its redirects first, so `#1904.b57b5ae4` needs a wrong program. The
twin is a copy of the change's `packages/github/src/rest.ts` with one planted fault, laid over the change.

| Criterion | Twin | The planted fault | Tests it fails |
|---|---|---|---|
| `#1904.b57b5ae4` (AC1) | `follows-redirects` | `forgeFetch` leaves redirects to fetch, which follows them to any origin, twenty deep | all twelve, the archive's two among them |
