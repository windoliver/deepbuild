# Blind redraft of three criteria (#29: AC3/AC4/AC6 twins, AC37, AC33's scheduler tests)

The surface in README.md is unchanged and so is the criteria table. Only the tests below changed, plus one Open point (14).

## floor.test.ts: the three wrong-program tests (AC3, AC4, AC6)

What changed: the first assertion's message now carries the thing the claim cites, and each `mustFail` names it:
``a file `src/cart.ts` ``, ``a missing deliverable `docs/receipt.md` ``, ``the masked run `pnpm test || true` ``.
`sentBackNaming`'s first `expect` message gained the `ref`; nothing it checks changed, so every other floor test asserts what
it did.

Why: each planted program (`no-read-check`, `no-deliverable-check`, `run-happened-only`) lets the claim through, so `floor`
returns `{ ok: true }`. There is no finding, so the first assertion (`r.ok` is `false`) is the only thing that can fail, and
its message was `a file: the claim goes back (...)`, which names nothing. The old `mustFail` names (`src/cart.ts`,
`docs/receipt.md`, `pnpm test || true`) could never appear in it, so those tests failed whatever the planted program did.
The thing named now comes from the test's own words. For AC3 it also pins the failure to the first case (the unread file),
since `src/cart.ts:2` in a later case would contain `src/cart.ts` too. The planted program still fails the first assertion;
a correct gate passes all of them.

## loops.test.ts: AC37 (`deep_claim` and `gh_pr_create`, main tests and wrong-program twins)

What changed: the script gets one more event, `prompt(320_000, 'continuation')`, 1 s after the fourth reply (319 s), as in
AC36. The fourth stop's held place also asserts `started_at` is `null`. The first snapshot's held place goes to the second
(`replaced_by` S2), the "again" of the criterion. `started_by` may also read `loop_paused` (open point 12).

Why: the design says a grace window that ends with no automatic prompt has paused the loop and starts the held checks then,
and rule 9 says so (`loop_paused`). The old script ended at the fourth stop with the goal active and no later prompt, so a
correct runner starts the held journey on S4 when the window ends (379 s) and the test failed it for being right. With the
continuation inside the window the loop has not paused, the slot is free (S3's journey landed at 314 s), and a runner that
starts the held check anyway is caught. The twin (`holds-claim-stop-for-loop`) still fails on the first assertion that
differs, naming `claim <via>`: it runs nothing on S3, or starts it later than 14 s, and its stop is not held until the
journey lands.

## stack.test.ts: AC33's scheduler tests (good run, warm-from-worktree, always-worktree, takes-environments-word)

What changed:
- A run's outcome comes from what it reads: `ends: { A: 'passed', B: 'failed' }` by `ctx.snapshot`, replacing
  `worktree_fails_on: 'B'`. That fails any run that starts after the edit, whatever tree it runs in, so the correct run failed
  too and "reads $18.00, passes" could not hold.
- The edit to B follows a new prompt after the stop's reply (prompt at 4 s, edit at 5 s) while the journey runs, as the
  criterion says; before, the edit sat inside the hold.
- The paths: the tests no longer expect `/tmp/dh29-stack/live` and the like, which the scheduler never receives. `start()` is
  handed `checkout` and `worktree` by the scheduler; the test records each call and asserts `reason` contains the recorded
  `${worktree}/web` and the process's name. It also asserts the stack starts from a checkout that is not the worktree, the
  trace's `stacks` entry for the run, and the attempts `[1, kept_product true]` then `[2, false]` (`StackDef.kept` and rule 14).
- The twin asserts the planted environments' first run is `uncounted`, naming the run, in place of `not 'passed'` (a counted
  FAIL passed that). The unplanted runner is run through the same assertion first and passes it.

Why: every value asserted is now one the test gave the scheduler or reads back from the trace. `takes-environments-word`
counts the first run, passed or failed, so `uncounted` fails it at `run <id>`.

## Not run

No implementation exists at the base, so nothing was run against a runner; that each planted program fails its assertion is
by reading README rules 9, 12 and 14. Type-check: `/tmp/dh29r-typecheck/run.sh` (a declaration-only copy of the README surface)
is clean. An unused `goesBack` helper appeared in `floor.test.ts` partway through; it was not mine and I removed it.
