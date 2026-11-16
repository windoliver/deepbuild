# Acceptance tests for #2635

Written blind at base commit 1e3b798c5 from the issue, AGENTS.md and the design's Dogfooding section only, without the fix. Run with `node --test tests/acceptance/2635/affected-cargo-missing.test.mjs` (Node 24 reads a bare directory argument as a module, not a test folder).

Each test runs in a scratch git repository holding a `Cargo.toml` and a copy of this checkout's `scripts/`, with a sandboxed HOME and a PATH of symlinks to `node`, `git`, `ps` and `sh` only. Command runs are bounded at 120 s, and on a timeout the child's process group is killed by its PID.

| Test | Criterion |
| --- | --- |
| `AC1: crates(cwd) with no cargo on PATH throws ...` | AC1, the `crates(cwd)` part: an `Error` (not a `TypeError`) whose message starts `cargo metadata failed:` and names `ENOENT` |
| `AC1: node scripts/affected.mjs with no cargo on PATH ...` | AC1, the command part: the output names `cargo` and that it couldn't start (`ENOENT`, "not found" or "could not start"), with no `TypeError` and no `reading 'trim'` |
| `AC2: a cargo that writes "error: boom" ...` | AC2: a cargo stub that writes `error: boom` to stderr and exits 101 gives `cargo metadata failed: error: boom` |
| `AC3: with no cargo on PATH, node scripts/affected.mjs exits non-zero ...` | AC3: a non-zero exit, not ended by a signal, and no `PASS affected` line |

The output of the run at base is in `BASE-FAILURE.txt`.
