# #1624 acceptance (blind draft, base ccbdefd1)

Files: `lanes.test.mjs` (the suite), `preflight-folders-only.proposed.mjs` and `preflight-folders-only.patch.md`
(the check-correction proposal). Nothing existing is edited.

**Adopting the proposal needs maintainer approval** (AGENTS.md: a check that covers a criterion changes only by an
approved proposal). It is a copy of `tests/preflight.test.mjs` whose only change is that the last test reads only the
folders under `tests/acceptance/` (`readdirSync(..., { withFileTypes: true }).filter(isDirectory)`). All assertions and
cases are kept; nothing is skipped, exempted, budget-changed or removed. The suite does not depend on it being adopted:
the AC1 test runs the real `tests/preflight.test.mjs` unchanged; once the maintainer approves, the same change goes there.

## Command (parent runs unchanged, from the checkout root)

    node --test tests/acceptance/1624/lanes.test.mjs

It needs `git` (for #1114's grep) and `node_modules`; no full preflight, no network.

## Criterion tags → proof

| Tag | Criterion (normalized) | Proof |
|---|---|---|
| AC1 | `tests/preflight.test.mjs › the unit lane runs each reference-Mac budget file alone, after the parallel block` passes | test "AC1 …passes" runs that named test from the real file by `node --test --test-name-pattern`; "AC1 308, 45 and 1017" lists the unit lane's parallel and alone blocks with `vitest list --filesOnly` (the lane's own commands) |
| AC1 | its entry leaves `scripts/known-failures.json` | test parses the real file, no id for that title |
| AC1 | (correction) | "AC1 the proposed folders-only…" runs the proposed copy against the real lists in a scratch tree |
| AC2 | `tests/acceptance/1114/timed-list.test.mjs` passes, naming 14 files on base | "AC2 …passes" runs it by node --test (reused, not duplicated); "AC2 …14 files" checks the real `timed` export covers each named file |
| AC3 | unit lane doesn't run `1330/start.live.test.ts`; its run lists no skip from it | "AC3" lists both unit-lane blocks with vitest and asserts the file is in neither; contrast test: `1330/start.test.ts`, `facts.test.ts` stay listed, and the already-by-hand `1202/session.live.test.ts` is not |

Wrong-program contrast: the base itself. The listing control (`14/budgets.test.ts` alone, `1202/session.live` out)
proves the listing reads the lane; the sibling check proves a blanket exclusion of #1330 fails.

## Expected on the base (ccbdefd1)

Fail: AC1 named test (ENOTDIR on `plans.ts`), AC1 known-failures (entry present), AC1 308/45/1017 (not in `alone`),
AC1 proposed copy (reads folders now, then fails on the missing `alone` entries of 308, 45, 1017), AC2 grep test (14
files named), AC2 14-file coverage, AC3 (`start.live.test.ts` is listed in the parallel block).
Pass on the base: the AC3 contrast test (siblings listed, 1202 live not listed, as the lists stand).

## Limitations

- AC3's "run lists no skip" is proved by the file not being listed, not by a full unit-lane run (no preflight here).
- Vitest's `list` takes the same `--exclude` and filter arguments as `run`; `--no-file-parallelism` is dropped for it.
- The proposal's fidelity to the base file (one changed block) is by review of the patch notes, not by test.
- The AC2 grep reads the git tree (`git ls-files`), so the checkout must be a git repository.
- Cannot be run in this authoring job (no shell); the parent runs it.
