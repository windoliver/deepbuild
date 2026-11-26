# Blind redraft of #3295's other two criteria, so the original suite file can run by hand

This folder and `../3295-redraft-fae86cca/` together replace the first draft's `../3295/late-close.test.mjs` in the
lanes. This folder holds that file's first two tests, `#3295.63a9095d` and `#3295.2acd3e71`, with the same names, tags,
control, stand-ins and assertions. `../3295-redraft-fae86cca/` holds its third, `#3295.fae86cca`, with a planted wrong
program of product source. Nothing in `../3295/` or `../3295-redraft-fae86cca/` is edited here.

## Why

- **The third test can't pass the before lane.** The before lane lays every file of the change under the test paths over
  the merge base (`prepareRuns`), and that includes `crates/deep-hook/tests/cli.rs`, where the issue's fix lives. So on
  the merge base the change's late-close test reads INCONCLUSIVE on the starved stand-in, and the first draft's
  `#3295.fae86cca` passes there. With no twin in `../3295/twins.json`, the lane reads FAIL. `../3295-redraft-fae86cca/`
  gives that criterion its twin, `drops-unread-call`.
- **The original file goes to `byHand`.** Main's before lane now honours `byHand` (#3300, #3321), so the owner's
  coordinator maps the original file to its redrafts there, in its own commit, which the owner signs. `byHand` takes
  whole files, so the file's other two tests, which pass the lanes as they are, would leave the lanes with it. This folder
  keeps them in the lanes.

## Inputs

Only these, as a blind job sees them:

- issue #3295's body;
- `AGENTS.md`, `docs/technical-design.md` (Dogfooding, the proof sections);
- the blind commit `890bbad12` (base `a288ae247`) with `../3295-redraft-fae86cca/` on top (`2b697475e`): the first draft
  in `../3295/`, `crates/deep-hook/src/main.rs` and `scripts/proof-runs.mjs`;
- the coordinator's word that main honours `byHand` in the before lane and that the original file moves there.

I read no other branch, PR, worktree or fix of the issue.

## What the folder holds

- **`late-close.test.mjs`** is the first draft's file with its third test taken out, along with the constants only that
  test used (`RULES_READ`, `RULING_LIMIT_S`, `TRIES`), and a new header comment. Everything else is line for line: the
  copy, the control, the `waits-for-close` and `never-spools` stand-ins, and the lanes' reading. The first draft's file
  exports nothing, so the code is carried over, not imported.
- **`twins.json`** maps the criteria to the twins as `../3295/twins.json` does. The twins in `twins/` are copied
  unchanged. The before lane looks a test's twins up in its own folder (`twinsOf`), so they must be here.

## The stand-ins

The tests build these from the checkout's own `main.rs`, with lines added at text each matched once. They are scenarios,
not wrong programs, and exist on the base and on the change alike. Each also logs `start` at the top of `forward`. A
control build, the checkout's hook as it is, must read the late-close test PASS for a stand-in's failure to count. A
control the lanes read INCONCLUSIVE skips the test with a note starting `INCONCLUSIVE:`.

| Stand-in | What is added | What the hook then does |
|---|---|---|
| `waits-for-close` | At the top of `forward`, stdin is read to its close; the call is then read from that buffer | It decides only once its agent closes stdin, so the late-close test kills it at its one-second deadline |
| `never-spools` | `spool_by` returns at once | It reads, matches and allows the call (exit 0), and spools nothing |

## Criteria, tests and twins

| Criterion | Test | Twin (`lines.json` over `crates/deep-hook/src/main.rs`) | How the test fails on its twin |
|---|---|---|---|
| `#3295.63a9095d` | `#3295.63a9095d the late-close test still fails on a deep-hook that decides only once its agent closes stdin: killed at the one-second deadline` | `waits-for-close`: the read loop reads to stdin's close, and the watchdog waits for the request with no limit | At the control assertion: the checkout's own hook is killed at the deadline, so the control reads FAIL |
| `#3295.2acd3e71` | `#3295.2acd3e71 the late-close test still fails on a deep-hook that allows the call and never spools it` | `never-spools`: `spool_by` returns at once | At the control assertion: the late-close test reads FAIL on the checkout's own hook |

Both criteria hold on the base, so each needs its twin. Neither twin replaces a test path or a `node_modules` file.
`#3295.fae86cca` is in `../3295-redraft-fae86cca/`, and `#3295.ef4b8343` stays checked by hand on the Spark, so a commit
says `Part of #3295`.

## Hand runs

`TWIN-RUN.txt` holds them, with date and load; scratch paths read `<tmp>` and home paths `<home>`.

1. The file on the checkout: both tests pass.
2. Each twin laid by its `lines.json` over an APFS clone (`cp -c`) of the checkout's workspace, each `find` matched once
   as `twinOverlay` does, with the run filtered to its test. Each test fails at its assertion.

The runs were made one at a time. The proof lanes weren't run.

## Running it

```sh
node --test --test-concurrency=1 tests/acceptance/3295-redraft-byhand/late-close.test.mjs
```

You need `cargo` and `node` 24 on `PATH`. A cold build of deep-hook takes minutes, and the file's later builds take
seconds.

The folder has no `lane.json`: the guard refuses one outside `tests/acceptance/<issue>/`. So it runs in the lanes' parallel
block, not alone as the first draft does. What that bears on:

- **A busy block can starve the control,** whose late-close test then reads INCONCLUSIVE. The test then skips as
  INCONCLUSIVE, which is unrun, never a pass. It can't turn a FAIL into a PASS.
- **The `waits-for-close` reading needs the test binary to run at least 1 s.** Load only lengthens that.
- **The 20-minute cap.** The test's own timeout is 19 minutes, and a busier block makes the cold build slower.

## Files

- `late-close.test.mjs`: the two tests.
- `twins.json`, `twins/waits-for-close/lines.json`, `twins/never-spools/lines.json`: the wrong programs.
- `TWIN-RUN.txt`: the hand runs.

No fixture holds a secret or personal data.
