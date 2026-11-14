# Acceptance test for #222, criterion 7 redrafted: a cue list's budgets, per frame independent of load order

A blind redraft (design: Dogfooding) of criterion 7's test, `AC7 #222.21cc8a35`: "Budgets, on the reference Mac in
the local preflight: 512 cues expand in under 10 ms at check, and a cue list costs nothing per frame beyond the channels
it writes". Written at base `f6d811c7` ("Merge pull request #2392 …") with the original blind suite brought in from
`61308d52` ("test(#222): blind acceptance tests for cue lists") as data to read, by a job that saw no implementation of
#222 and no other worktree, branch, PR or session. The implementing agent doesn't edit these files (AGENTS.md, Proof).

**It supersedes** the AC7 test in `tests/acceptance/222/budgets.test.ts` (the one `it` there, both clauses). The suite's
other tests stand.

## The dispute

The superseded test presented the 512-cue film and the same motion written as channels in one process, cue film first,
evaluated each at 1.03 s then 1.07 s, and required every node with `run: "ran"` in the cue film's second `eval` reply to
have a match, by operator and item, among the hand film's. That comparison can't tell an expander that works per frame
from one that doesn't, and it fails for a correct one:

- An `eval` reply's `nodes` lists the check phases' nodes "as the revision's check had them, then the frame phases' for
  the last frame" (`Session::nodes`, `crates/deep-canvas/src/schedule/mod.rs`); frames never run a check phase
  (`run_frame` skips `is_check_phase`). So a check-phase node such as `core.lower | s0` (phase `validate`) or
  `motion.compile` (phase `plan`) reads `ran` in every reply after the revision that ran it, whatever the frame did.
- The two films hold byte-identical squares. The film presented first runs `core.lower` for them (`ran`); the second
  finds the same content keys in the process's shared cache (`hit`). So the first film's reply carries eight more `ran`
  nodes than the second's, and swapping the order moves them to the other side. The expander isn't involved.

## What this redraft does

Same numbers, same films, same surface; only the per-frame comparison changes.

- **Each film in its own fresh debug process** (`deep-show run` keeps its cache across processes only with `--cache`,
  which the suite never passes), each `deep show` then `eval` at 1.03 s, 1.07 s and 1.27 s. Neither film loads first,
  and neither's check or frames can turn the other's nodes into hits.
- **A frame's work** is the reply's nodes outside the check's phases (the design's closed list, Canvas modules: "a check
  runs load, expand, resolve, validate, plan, build, estimate and check") whose `run` isn't `kept`: the nodes the frame
  ran or looked up. A node with no phase, or a phase outside that list, counts as per-frame work. `ran` and `hit` count
  alike, so the cache never decides the comparison.
- **Judged at 1.07 s** (inside group 4's cues, after a frame at 1.03 s) **and at 1.27 s** (the frame that enters group
  5's cues), each against the hand film's frame at the same time:

| # | Assertion | The wrong program it fails on |
|---|---|---|
| 1 | Every square has work in both films' frame | A cue list that moves nothing in the frame (the base, where `cues@1` is skipped), which would leave 2 and 3 nothing to judge |
| 2 | No node of the cue list's own item (`list`) does work | An expander or a cue reader that is an operator on the cue list's item in a frame phase |
| 3 | The cue film's work, as `operator \| item` with repeats, lies within the hand film's | A document node, or a node per cue or per expanded channel, that reads the cues each frame, or only in a frame that enters a new cue (the 1.27 s frame); the channels the cue list wrote evaluated by an operator of their own, beside or instead of motion's |
| 4 | `timing.expand_ms.list` over five fresh release processes, judged against 10 ms by `judgeLimit`, never FAIL; else INCONCLUSIVE | An expander slower than 10 ms on 512 cues |

Assertion 4 is the superseded test's timing clause, unchanged: the expander's own wall time at check on `deep show` with
`include: ["timing"]`, its expansion holding all 512 markers; `judgeLimit` (scripts/benchmark.mjs) first says whether
this machine can judge a timing now (a reference Mac, Low Power Mode off, thermal state nominal, the load under the core
count), and if not the test is INCONCLUSIVE before anything is built in release; then one warm-up process and five
fresh ones. It is its own `it` now, so an INCONCLUSIVE timing never hides the per-frame result.

**Why the hand film stays a fair reference.** Motion evaluates channels with one `motion.channels` node per target item
per frame (`crates/deep-canvas-motion/src/module.rs`: "each item a channel or a placement writes then has one node per
frame"), plus one document `motion.clock` node. So the hand film's 8 channels and however many channels the expansion
writes on the same 8 squares cost the same nodes, and the cue list's markers cost none of their own.

**Not caught here.** A cue reader folded inside the per-item channel node (same operator, same item) shows only as
time, and the issue gives no per-frame time limit; this test doesn't time frames.

## What was read

- Issue #222, live (`gh issue view 222`), and the dispute as the redraft's brief stated it.
- `docs/canvas-primitives.md`: Cue list `cues@1` (Semantics: "Expanded at check, never per frame"; Cost: "O(cues ×
  targets) at check, under 10 ms for 512 cues (estimate); then as the channels it writes").
- `docs/technical-design.md`: Canvas modules (the closed lists of check and frame phases); Films and figures on the
  canvas (the cue list paragraph).
- The original suite at `61308d52`: `tests/acceptance/222/README.md`, `helpers.ts`, `budgets.test.ts`,
  `BASE-FAILURE.txt`, `tsconfig.json`.
- At the base: `crates/deep-canvas/src/schedule/mod.rs` (`is_check_phase`, `Run`, `run_frame`, `Session::nodes`, how a
  visited node settles as `ran`, `hit` or `kept`); `crates/deep-canvas/src/registry/mod.rs` (the phase lists);
  `crates/deep-canvas/src/schedule/core_ops.rs` (`core.lower` in `validate`); `crates/deep-canvas-motion/src/module.rs`
  (`compile` in `plan`, `clock` and `channels` in `items`, `has_clock`, `is_target`); `crates/deep-show/src/frames.rs`
  (`eval`'s reply: `nodes` with `phase` and `run`); `crates/deep-show/src/main.rs` (`--cache`); `scripts/benchmark.mjs`
  (`judgeLimit`); `scripts/lanes.mjs`.

## Run it

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/222-redraft-ac7 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/222-redraft-ac7/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/222-redraft-ac7/node_modules/.vite
```

It imports `../222/helpers.ts` as it stands (the films' parts, `deep-show run`, the expansion's reader, `judgeLimit`), so
it needs the original suite beside it. The file builds `deep-show` in debug once, in `beforeAll`, and in release only on
a machine that can judge a timing. The implementer adds to `scripts/lanes.mjs` (this job writes only this folder):

```js
alone.push('tests/acceptance/222-redraft-ac7/');
timed.push('tests/acceptance/222-redraft-ac7/budgets.test.ts');
```

## At the base

Not run: nothing of #222 exists at `f6d811c7`. `BASE-FAILURE.txt` says where each test fails, read from the base's
code. The type-check exits 0.
