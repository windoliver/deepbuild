# Acceptance tests for #1407: a panic in deep-hook while it rules on a call

Written first, blind, from issue #1407 (its text as of November 7, 2026, last edited 2026-11-07T10:52:47Z: the
summary, Scope, the 3 checkbox criteria, Proof and Not in scope; it has no comments), `AGENTS.md`, the design's
[Hook protocol (deep-hook and the hub)], the deep-hook rows of [One hub per user, a tiny hook client, and extensions
in-process] and [Threats] ("A broken hub"), Dogfooding and Wrong programs, and base commit `2bba2a50` (origin/main),
by a job that never saw an implementation of #1407. The base code read: `crates/deep-hook/src/main.rs` (`forward`,
`rules`, `denials`, `watchdog` and its `RULING`/`RULED`/`DENIAL` flags, `main`), `crates/deep-hook/src/matcher.rs`
(`Call::matches`) and `crates/deep-hook/Cargo.toml` (the existing `plant-*` features); `tests/acceptance/304/` is the
model for conventions and helpers. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job.

The issue has 3 checkbox criteria, AC1 to AC3 in the body's order. This suite covers all three.

| Criterion | ID | File |
|---|---|---|
| AC1 With a panic planted in the matcher and a fail-closed rule that would apply, deep-hook exits 2 and prints a denial; on main it exits 101 | `#1407.3799f437` | `panic.test.ts` |
| AC2 With the same plant and no fail-closed rule that applies, the call is allowed, as with the hub down | `#1407.055ae8d4` | `panic.test.ts` |
| AC3 A normal denial and a normal allow are byte-identical to before | `#1407.14eb6bf3` | `unchanged.test.ts` |

Each ID is `#1407.` and the first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed.

## How to run

With the repo's Node (`.node-version`, 24.22.0), its `node_modules` (for vitest) and the Rust toolchain:

```sh
cargo build --locked -q -p deep-hook     # warm the plain binary so a beforeAll doesn't wait on it under load
npx vitest run --root tests/acceptance/1407 --no-file-parallelism
```

- Only cargo builds are needed: no `npm run build`, no hub, no network, no model. The tests build
  `target/debug/deep-hook` (this checkout, plain), `target/plant-matcher-panic/debug/deep-hook` (the planted twin) and
  `target/base-2bba2a50/debug/deep-hook` (the base commit's, AC3). Cargo runs under `nice -n 10`; set
  `CARGO_BUILD_JOBS` on a loaded machine.
- `--no-file-parallelism` keeps both files from building `target/debug` at once.
- The base binary is built from the base commit's own sources: `git archive 2bba2a50 Cargo.toml Cargo.lock .cargo
  crates vendor`, unpacked into a temp folder under `/tmp` and built there with `--target-dir target/base-2bba2a50`.
  The working tree, the index and the repo's worktree list are never touched.
- Every hook runs with its own temp `HOME` under `/tmp/dh1407-*` that holds only `.deepbuild/rules.json`, so nothing
  is at the hub's address: this is the hub-away path. The real `~/.deepbuild` is never read or written. A child never
  inherits this process's billing keys or `DEEP_*`, `GIT_*`, `XDG_*`, `CLAUDE*`, `CURSOR*`, `CODEX*` or `RUST_*`
  settings (so no `RUST_BACKTRACE` changes a panic's text). The suite stops only processes it started, by PID.
- No call is ever executed: each is a Claude Code `PreToolUse` payload deep-hook decides on.
- A hook or build killed at its timeout throws `INCONCLUSIVE`, never passes.
- Type-check with `node node_modules/typescript/bin/tsc -p tests/acceptance/1407/tsconfig.json`.

## The surface under test

**The hook.** deep-hook runs as Claude Code's hook entry runs it: `deep-hook claude-code PreToolUse`, a Bash
`PreToolUse` payload on stdin (`helpers.ts`, `hook`, `bashPreToolUse`). `claude-code` is the agent name the base's
`caller` and #304's suite use. A denial is exit 2 with the reason on stderr; an allow is exit 0.

**The rules.** `rules.json` is `{"v": 1, "entries": {<name>: guard@1}}`. The fail_closed entry is `t-closed`,
`run:gh pr merge`, and the call it applies to is `gh pr merge 12`: on the base, with the hub away, that call is
denied (exit 2, "DeepBuild blocked this: Test entry t-closed holds this call. …"), so the entry would apply.

### The plant: `plant-matcher-panic`

The issue's proof is "the planted panic in both cases". The implementer adds a Cargo feature to
`crates/deep-hook/Cargo.toml`, **`plant-matcher-panic`**, beside the existing `plant-*` features: in that build,
**`Call::matches` (`matcher.rs`) panics whenever it is called**, for any pattern, on the thread that calls it (the
hook's main thread, as `forward` matches today). Nothing else changes in that build. It is a Cargo feature, never an
environment variable (#1408: a setting an agent's environment can carry must not plant a wrong program into the
shipped binary). The tests build it with `cargo build --locked -q -p deep-hook --features plant-matcher-panic
--target-dir target/plant-matcher-panic`.

On the base that build fails ("the package 'deep-hook' does not contain this feature"), so each planted test fails
as `BLOCKED` there. That is the documented base failure for the planted cases. What the base does with the panic
itself was shown by hand (BASE-FAILURE.txt): a temp copy of the base with the same `panic!` in `Call::matches` exits
101, prints Rust's panic message, and prints no denial, with and without a fail_closed entry.

### AC1: the denial

With the plant, `t-closed` in `rules.json` and the hub away, `gh pr merge 12` must give:

- exit **2** (the issue: "only exit 2 blocks the call"; the base exits 101);
- stderr starting **`DeepBuild blocked this:`** and holding the watchdog's words **`couldn't read this call and check
  it against the guards`** (Scope: "using the same wording as the watchdog's"; the base's `watchdog` prints
  "DeepBuild blocked this: deep-hook couldn't read this call and check it against the guards that hold while the hub
  doesn't answer within 500 ms. Retry it." for a call it couldn't match). The rest of the line is the implementer's;
- no Rust panic text (`panicked at`) on stderr, and no `permissionDecision: allow` on stdout.

A control first runs the same call on the plain build and requires its denial in `t-closed`'s words, so the
fail_closed entry is one that applies.

### AC2: "no fail-closed rule that applies"

`rules.json` holds only entries that aren't fail_closed: `t-open` (`run:gh pr merge`, which matches the call) and
`t-other` (`run:ls`). Two calls run, `gh pr merge 12` (matched by an entry that isn't fail_closed) and `echo hello`
(matched by nothing). Each is run on the plain build and on the planted build, on the same HOME path and the same
input; the planted build's exit code, stdout and stderr must equal the plain build's, which must be an allow (on the
base: exit 0, empty stdout and stderr). That is "allowed, as with the hub down" made exact, and it is what Scope says:
"a panic behaves as the hub-down path does today".

Why not a fail_closed entry for a different call: the panic happens while the matcher reads whether an entry applies,
so with any fail_closed entry installed deep-hook can't know that none applies. Scope's first bullet ("if a
fail-closed rule may apply") and the design's fail-closed rule (a call a fail_closed entry may hold is never let
through unchecked; the base's watchdog denies such a call it couldn't match) make denial the answer there. So "no
fail-closed rule that applies" is tested as "no fail_closed entry installed", and the suite asserts nothing about a
panic with a fail_closed entry installed for another call.

### AC3: byte-identical to before

"Before" is the base commit's deep-hook built from its own sources (above); "now" is this checkout's plain build.
Each case writes the same `rules.json` (`t-closed` fail_closed on `run:gh pr merge`, `t-open` not fail_closed on
`run:ls`) into a HOME at the same path, emptied between the two runs, sends the same payload bytes, and compares
exit code, signal, stdout and stderr exactly:

- a normal denial: `gh pr merge 12` (base: exit 2, `t-closed`'s denial on stderr);
- a normal allow of a matched entry that isn't fail_closed: `ls -la` (base: exit 0);
- a normal allow of an unmatched call: `echo hello` (base: exit 0).

The spool file deep-hook writes under HOME carries the time and a fresh ID, so it is not compared. One stderr line
is set aside on both sides before comparing (`helpers.ts`, `steady`): "deep-hook: spooled <a fresh ULID>, but its sync
didn't finish within the hook's 50 ms", which deep-hook prints when the spool's fsync runs past 50 ms. Its presence
depends on the disk's timing, not the decision, and its ID is new on every run, so the base differs from itself on
it under load (the first base run of this suite showed exactly that). Everything else on stderr, and all of stdout,
the exit code and the signal, is compared byte for byte. AC2 compares stderr the same way, and AC1 reads the denial
past that line. On the base this
suite compares the base with itself and passes by construction: it is regression protection for the fix. To show
the comparison can fail, a wrong-program case runs the denial through the planted build and requires the comparison
to fail (its denial is the watchdog's or a panic, never `t-closed`'s); on the base that case is `BLOCKED` with the
plant's missing feature.
