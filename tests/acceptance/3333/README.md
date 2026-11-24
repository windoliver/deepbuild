# Acceptance tests for #3333

A lane's `cargo test` the throttle gave no build grant reads INCONCLUSIVE, naming the grant, not FAIL. Written blind
from the issue, `docs/parallel-proof.md` (section 6) and `docs/technical-design.md`, at base 3c564bbdd.

## The surface

Each test makes a HOME and so a throttle table of its own (the throttle keeps a table of a test's own only inside a
`node --test` run). For a refused run, real holders (`throttle.mjs build --wait 0 -- sleep`) take build grants until
one is refused, so the table grants no more. The lane's cargo test command (`cargo test --workspace --locked
--no-fail-fast`) then runs through the real `scripts/throttle.mjs build --wait 0 -- …` on a tiny fixture workspace, as
`runLanes` runs it (with `--wait 0` for `--wait 30`, and without `scripts/lease`). Its output and exit are read by the
checkout's own `cargoResults`, `crates` and `readRun` from `scripts/lanes.mjs`, in a process of their own. A compile
error is a real `cargo test` on a fixture whose test doesn't compile (`error[E0308]`). No `lane.json`: each test's
table, HOME and fixture target are its own, so the files can run in parallel.

## Criteria

| Criterion | Test (file) | Base | Twin |
| --- | --- | --- | --- |
| `#3333.228b62b7` A cargo lane refused a build grant reads INCONCLUSIVE, naming the grant | `a cargo lane refused a build grant reads INCONCLUSIVE, naming the build grant that never came` (no-grant.test.mjs) | fails: `readRun` reads no state (`found` undefined, `explained` false) | — |
| `#3333.228b62b7` | `no row of a cargo lane refused a build grant reads FAIL or PASS` (no-grant.test.mjs) | fails: row `cargo test: FAIL` (`exited 3`) | — |
| `#3333.5a039cd1` A real compile error still reads FAIL | `a real compile error in a cargo lane the throttle granted still reads FAIL` (compile-error.test.mjs) | passes | `every-exit-inconclusive` fails it |
| `#3333.5a039cd1` | `a real compile error in cargo test run without the throttle still reads FAIL` (compile-error.test.mjs) | passes | `every-exit-inconclusive` fails it |
| `#3333.82f286dc` A planted `cargoResults` that maps no-grant to FAIL fails | `cargoResults reads a run the throttle refused as the missing grant, never as a FAIL` (no-grant.test.mjs) | fails: failure `cargo test: FAIL` | `no-grant-fail`, `no-grant-beside-fail` fail it |

`BASE-FAILURE.txt` holds the base run: the three no-grant tests fail at their assertions because `cargoResults`
reads the throttle's exit 3 as `cargo test` FAIL (`exited 3`); the compile-error tests pass. `twins/README.md` says
what each twin plants and where each fails.
