# AC7 blind redraft: two hooks stamped the same nanosecond, two IDs, both in the record

Criterion `#315.2a5a4d2b`: "Two hooks of one session with the clock fixed to the same nanosecond get different IDs,
and both are in the record".

Test: `spool-ac7-redraft.test.ts`, one `describe` ("AC7 #315.2a5a4d2b two hooks of one session with the clock fixed
to the same nanosecond get different IDs, and both are in the record (redraft)") with two tests:

- "AC7 hub up: two PreToolUse hooks of one session stamped …789 carry that stamp, two different IDs, and are two
  events stamped …789"
- "AC7 hub stopped, then started: two PreToolUse hooks of one session stamped …790 are spooled with that stamp and two
  different IDs, and are two events stamped …790"

It imports the suite's `helpers.ts` unchanged. No other file was edited: `spool.test.ts` still holds the first draft's
AC7, and the owner decides whether this redraft replaces it.

## The dispute

The first draft (`spool.test.ts`, AC7) runs both halves in one test. The hub-up half fixes deep-hook's clock to
`STAMP_A` (`1760013451123456789`), the hub-stopped half to `STAMP_B` (`1760013451123456790`). Both halves call one
`check()` that hard-codes `STAMP_A`:

```ts
expect(requests.map((l) => l.seq), `${how}: both requests carry the fixed stamp`).toEqual([STAMP_A, STAMP_A]);
...
expect(e[0]!.seq, `${how}: ${id} recorded with the fixed stamp`).toBe(STAMP_A);
```

So the hub-stopped half demands that hooks stamped …790 carry …789. A correct deep-hook stamps them …790 (README,
Test-only settings: "`seq` is this string"), and the test fails on it: `hub stopped, then started: both requests carry
the fixed stamp: expected [ '1760013451123456790', …(1) ] to deeply equal [ '1760013451123456789', …(1) ]`. No
program can pass both halves, so the test can't prove the criterion. At the base the defect never showed: the hub-up
half failed first (`BASE-FAILURE.txt`, AC7), so the hub-stopped half never ran.

## What changed

- `check(requests, events, stamp, how)` takes the stamp the half fixed; each half passes its own (…789 hub up, …790
  hub stopped). Nothing else in the check is looser.
- The two halves are two tests, each with its own home and session, so each shows its own result (at the base, both
  fail on their own; in the first draft the second half could never run there). The hub-stopped test starts and stops
  the hub once before the hooks, as AC6 does ("the hub has run once and is stopped").
- Both halves select the requests by event (`PreToolUse`) and the session's ID, the spool's as well as the
  forwarder's.

Kept as the first draft had them: the forwarder in front of the hub for the hub-up half; the address setting removed
so the hub-stopped half's hooks go to the spool; the stamps; `bash(s, 'ls')` hooks; each hook must exit 0.

## Assertions, per half

| # | Assertion | Source |
|---|---|---|
| 1 | Each hook exits 0 | scenario precondition (a hook that fails didn't run as the agent's hook) |
| 2 | The two requests (forwarder bytes hub up; spool lines hub stopped) carry `seq` equal to the fixed stamp, exactly two of them: `toEqual([stamp, stamp])` | "with the clock fixed to the same nanosecond"; README: "`seq` is this string" |
| 3 | Each request's `id` is a ULID | issue Scope: "`id`, a ULID minted at the same moment" |
| 4 | The two IDs differ | "get different IDs" |
| 5 | Each ID is one event in the record (`events.read`) | "both are in the record"; Scope: "the hub appends it once" |
| 6 | Each of those events has `seq` equal to the fixed stamp | Scope: "a replayed event keeps both" (seq and id) |

The wrong program each catches: a deep-hook that ignores the fixed clock (2, the base), one whose ULID comes only from
the stamp so two hooks the same nanosecond collide (4), and a hub that dedupes by `seq` or drops one of two events with
the same stamp, whether forwarded or replayed from the spool (5), or rewrites the stamp (6).

## Type check (in the issue's worktree)

```
$ node node_modules/typescript/bin/tsc -p tests/acceptance/315/tsconfig.json
tsc exit 0
```

## Run on the base

A detached worktree of `33eaad3` outside the checkout, with `tests/acceptance/315/` (`helpers.ts`, `tsconfig.json`,
`fixtures/` and this test) copied in. Node v24.22.0, `npm ci` (exit 0), `npm run build --workspaces` twice (both exit
0), then (paths redacted):

```
$ node node_modules/vitest/vitest.mjs run --root tests/acceptance/315 --no-file-parallelism --reporter=verbose spool-ac7-redraft

 RUN  v5.0.5 <checkout>/tests/acceptance/315

 × spool-ac7-redraft.test.ts > AC7 #315.2a5a4d2b … (redraft) > AC7 hub up: two PreToolUse hooks of one session stamped …789 carry that stamp, two different IDs, and are two events stamped …789 6940ms
   → hub up: both requests carry the fixed stamp 1760013451123456789: expected [ '1792656826899996000', …(1) ] to deeply equal [ '1760013451123456789', …(1) ]
 × spool-ac7-redraft.test.ts > AC7 #315.2a5a4d2b … (redraft) > AC7 hub stopped, then started: two PreToolUse hooks of one session stamped …790 are spooled with that stamp and two different IDs, and are two events stamped …790 496ms
   → hub stopped, then started: both requests carry the fixed stamp 1760013451123456790: expected [ '1792656827216686000', …(1) ] to deeply equal [ '1760013451123456790', …(1) ]

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  … > AC7 hub up: …
AssertionError: hub up: both requests carry the fixed stamp 1760013451123456789: expected [ '1792656826899996000', …(1) ] to deeply equal [ '1760013451123456789', …(1) ]

- Expected
+ Received

  [
-   "1760013451123456789",
-   "1760013451123456789",
+   "1792656826899996000",
+   "1792656826908953000",
  ]

 ❯ check spool-ac7-redraft.test.ts:21:94
 ❯ spool-ac7-redraft.test.ts:48:5

 FAIL  … > AC7 hub stopped, then started: …
AssertionError: hub stopped, then started: both requests carry the fixed stamp 1760013451123456790: expected [ '1792656827216686000', …(1) ] to deeply equal [ '1760013451123456790', …(1) ]

- Expected
+ Received

  [
-   "1760013451123456790",
-   "1760013451123456790",
+   "1792656827216686000",
+   "1792656827221888000",
  ]

 ❯ check spool-ac7-redraft.test.ts:21:94
 ❯ spool-ac7-redraft.test.ts:66:5

 Test Files  1 failed (1)
      Tests  2 failed (2)
   Duration  7.55s (tests 99%)

vitest exit 1
```

Both tests fail for the expected reason: the base deep-hook ignores `DEEP_HOOK_TEST_CLOCK_NS` and stamps from the real
clock. The hub-stopped test shows the base did spool both hooks (two requests, each with a `seq`), so it reaches the
stamp assertion rather than failing on a missing spool. The worktree was removed afterwards
(`git worktree remove --force`).

## Not run

- The redraft wasn't run against the implementation in the issue's worktree (another lane was timing tests there), so
  it isn't shown passing on any program. Assertions 3 to 6 haven't failed at the base because assertion 2 fails first
  in each test; no planted wrong program exists for them.
