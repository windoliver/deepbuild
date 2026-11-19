# Blind redraft of #2744's tests that #2833's limit contradicts

#2833 raises the Spark's (Linux's) test limit in `scripts/throttle.mjs` from 4 grants to 6. `tests/acceptance/2744/helpers.mjs` hard-codes `TEST_LIMIT = darwin ? 2 : 4`, and two #2744 tests fill that many slots and then expect a request to wait. With 6 slots, two slots are still free after the fourth grant. This folder redrafts those two tests from #2744's criteria (as `tests/acceptance/2744/README.md` quotes them), #2833's text and its comment, and the base `c26bdb5be`. #2833's blind acceptance job drafted them, using #2833's surface: the machine's test limit is the one `scripts/throttle.mjs` states for the platform on its `LIMITS` line. So the next change to that limit won't contradict these tests again.

The originals are not edited or deleted; a person approves the swap. Run with:

```
node --test 'tests/acceptance/2744-redraft-2833/*.test.mjs'
```

They import `tests/acceptance/2744/helpers.mjs` unchanged for everything except the limit. `helpers.mjs` here has one function, `testLimit()`. `LIMITS` isn't exported, and no #2744 test imports the code under test, so the function reads `scripts/throttle.mjs` as text. It takes the single `const LIMITS = process.platform === 'darwin' ? {...} : {...}` line, picks the branch for the current platform and returns its `test` value. It throws, and the test fails, when there isn't exactly one such line, the line has another shape, the branch names `test` other than once, or the value isn't a positive integer literal. It never falls back to a number. Checked against five synthetic `LIMITS` lines: the well-formed one gave 6, and the other four each threw.

## What each redraft replaces

One change serves both. Each test's `TEST_LIMIT` is now `testLimit()`, read when the test starts. Test names, criterion IDs, assertions, messages and expected values are the originals', line for line (`diff` shows only the imports, a header comment and the `const TEST_LIMIT = testLimit();` line).

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `2744/machine.test.mjs` › #2744.e34b52c0 test requests from processes with different HOMEs share the machine's test limit: the next one waits, then runs once a slot frees | #2744.e34b52c0 (AC1, one table per machine) | It fills 4 slots and expects the fifth request to wait. Under #2833 the machine has 6 slots, so the fifth request is granted at once, and the test reads that as "each HOME got a table of its own", the AC1 bug it was written to catch | `machine.test.mjs` › same name, filling `testLimit()` slots (6 on Linux under #2833, 4 on the base, 2 on macOS) |
| `2744/hung.test.mjs` › #2744.e68bc50e a test grant whose command never exits (it ignores SIGTERM, and so does its child) is ended past its --hold bound while a test request waits: INCONCLUSIVE, exit 3, its tree stopped, released, and the waiting request granted | #2744.e68bc50e (AC2, a hung holder doesn't stop the machine) | Besides the hung grant it fills only 3 more slots. Under #2833 two slots stay free, so the waiter is granted at once, before the hung grant's 0.05 min bound, and the test fails with "the waiter ran before the hung grant's 0.05 min bound had passed" | `hung.test.mjs` › same name, filling `testLimit() - 1` slots beside the hung grant |

`hung.test.mjs` here holds only the first test. The second stays in the original file.

## Kept as they are

These don't depend on how many test slots the machine has:

- `2744/hung.test.mjs` › #2744.e68bc50e a hung test grant is never ended while no one waits, and is ended past its --hold bound once a timed request waits: it holds one test slot and makes a timed request wait.
- `2744/drain.test.mjs`, both #2744.303fcdcd tests: a timed request drains behind one holder, and a test request queues or runs next to it. Neither fills the test class.
- `2744/helpers.mjs`: unchanged and still imported. Once the swap is approved, only `TEST_LIMIT` loses its callers.

No twins here. #2744's README ships none, and the redrafts keep the original criterion IDs.

## On the base and on a throttle that meets #2833

Both programs ran on the Spark (Linux), each file once per program, in a transient `systemd-run --user` unit with `MemoryMax=24G`, `MemorySwapMax=2G` and `CARGO_BUILD_JOBS=2`. Each run used the sandboxed throttle tables from #2744's helpers; the live table was never touched.

On the base `c26bdb5be` (`test: 4`), both pass:

```
$ node --test tests/acceptance/2744-redraft-2833/machine.test.mjs
✔ #2744.e34b52c0 test requests from processes with different HOMEs share the machine's test limit: the next one waits, then runs once a slot frees (3619.40927ms)
ℹ tests 1  ℹ pass 1  ℹ fail 0
$ node --test tests/acceptance/2744-redraft-2833/hung.test.mjs
✔ #2744.e68bc50e a test grant whose command never exits (it ignores SIGTERM, and so does its child) is ended past its --hold bound while a test request waits: INCONCLUSIVE, exit 3, its tree stopped, released, and the waiting request granted (14530.742332ms)
ℹ tests 1  ℹ pass 1  ℹ fail 0
```

The second program was a throwaway worktree of `c26bdb5be` with one change, `test: 4` → `test: 6` on the Linux branch of `LIMITS` in `scripts/throttle.mjs`. It isn't kept. On it, `testLimit()` read 6 (and 2 for darwin), and the redraft passes:

```
$ node --test tests/acceptance/2744-redraft-2833/machine.test.mjs
✔ #2744.e34b52c0 test requests from processes with different HOMEs share the machine's test limit: the next one waits, then runs once a slot frees (4037.830288ms)
ℹ tests 1  ℹ pass 1  ℹ fail 0
$ node --test tests/acceptance/2744-redraft-2833/hung.test.mjs
✔ #2744.e68bc50e a test grant whose command never exits (it ignores SIGTERM, and so does its child) is ended past its --hold bound while a test request waits: INCONCLUSIVE, exit 3, its tree stopped, released, and the waiting request granted (14382.188345ms)
ℹ tests 1  ℹ pass 1  ℹ fail 0
```

On the same throwaway, the originals fail as the table says:

```
$ node --test tests/acceptance/2744/machine.test.mjs
✖ #2744.e34b52c0 test requests from processes with different HOMEs share the machine's test limit: the next one waits, then runs once a slot frees (3579.182111ms)
    AssertionError [ERR_ASSERTION]: the request after 4 test grants, from yet another HOME, ran at once: each HOME got a table of its own
ℹ tests 1  ℹ pass 0  ℹ fail 1
$ node --test tests/acceptance/2744/hung.test.mjs
✖ #2744.e68bc50e a test grant whose command never exits (it ignores SIGTERM, and so does its child) is ended past its --hold bound while a test request waits: INCONCLUSIVE, exit 3, its tree stopped, released, and the waiting request granted (854.422078ms)
    AssertionError [ERR_ASSERTION]: the waiter ran before the hung grant's 0.05 min bound had passed: it can't have waited for that slot
✔ #2744.e68bc50e a hung test grant is never ended while no one waits, and is ended past its --hold bound once a timed request waits (6334.590528ms)
ℹ tests 2  ℹ pass 1  ℹ fail 1
```

Passing on the base and on the throwaway doesn't add new proof of #2744's criteria. The wrong programs for those criteria are still the ones #2744's README lists. This redraft only stops the two tests from assuming a slot count that `scripts/throttle.mjs` no longer has.
