# Acceptance tests for #2902: an old checkout's waiter can't cap the machine at its own limit

A blind job wrote these tests before any fix existed, from issue #2902 (its text on 2026-11-19), `docs/parallel-proof.md`
section 6, the Dogfooding part of `docs/technical-design.md`, AGENTS.md and base commit `6a2b68d44`. At the base it
read `scripts/throttle.mjs` and the acceptance folders `2744/`, `2744-redraft-2833/` and `2574/` for style. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

Run them (Linux; they must run under `node --test`, since section 6 lets a request use `DEEP_THROTTLE_TABLE` only inside
a test run):

```sh
node --test tests/acceptance/2902/*.test.mjs
```

**No test reads or writes the live table at `~/.deepbuild/throttle/`.** Both reuse #2744's sandbox
(`../2744/helpers.mjs`): every `throttle.mjs` process gets `DEEP_THROTTLE_TABLE` pointed at a fresh folder of the
test's own and a temporary `HOME`, runs in its own process group with a stub command, and after the test each group is
stopped by its PID. The current code's test limit is read from `scripts/throttle.mjs`'s `LIMITS` line
(`../2744-redraft-2833/helpers.mjs`), never hard-coded.

## Criteria

| Criterion | Test (`queue.test.mjs`) | What it checks |
|---|---|---|
| AC1 | `#2902.5c1e8a3f` | 4 current-code test grants held. An old checkout's waiter, a live process running the base commit's `scripts/throttle.mjs` (which records no limit in a request) with its Linux `test` limit text-replaced to 4, from a folder in the sandbox, against the same table, is alone at the head of the test queue and isn't granted. Then current-code requests, one after another, are each granted within 60 s, up to the current limit (6 at the base), while the old waiter stays live in the queue, ungranted. The next request reaches the table and, 3 s later, still waits ungranted; the table holds exactly the current limit's test grants. Skipped on macOS (both limits are 2 there). |
| AC2 | `#2902.b47d09e2` | No old waiter. The test class full (the current limit's holders); an earlier request then a later one queue. When one holder finishes, the earlier is granted and the later still waits in the table; when another finishes, the later is granted. |
| AC3 | none: review | The issue gives no wording for section 6's statement of the rule, so a test would pin words of my own. Review checks that `docs/parallel-proof.md` section 6 states it: each request records its limit; a waiter whose recorded limit has no room is passed over; a request recording no limit counts as allowing one grant; so a class's machine limit is the largest among its live waiters. |

The only fixed wait is AC1's 3 s before the negative check on the request past the limit (about 15 of the throttle's
200 ms polls); every positive step waits on the table or on the stub's start note.

## At the base

`BASE-FAILURE.txt` is the base's output: AC1 fails because the current code's first request past the 4 held grants
waits behind the old checkout's waiter at the head of the queue and isn't granted in 60 s; AC2 passes.
