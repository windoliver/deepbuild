# Blind redraft of #1407's acceptance tests (`#1407.3799f437`, `#1407.055ae8d4`, `#1407.14eb6bf3`)

I read issue #1407 (body as of November 7, 2026, no comments), `AGENTS.md`, `docs/technical-design.md` (Dogfooding,
Wrong programs, "Fail before, pass after", "Failing on an assertion"), `scripts/proof-runs.mjs` (`asserted`,
`atAssertion`, `twinsOf`, `before`), this suite's first draft (`../README.md`, `../helpers.ts`, `../panic.test.ts`,
`../unchanged.test.ts`, `../BASE-FAILURE.txt`), `../../111/redraft/README.md`, and at base `2bba2a50` the code:
`crates/deep-hook/src/main.rs` (`forward`, `denials`, `spool_by`, `watchdog` and its `RULING`/`RULED`/`DENIAL`
flags), `crates/deep-hook/src/matcher.rs` (`Call::matches`) and `crates/deep-hook/Cargo.toml` (the `plant-*`
features). I saw no implementation of #1407.

| Criterion | ID | Test |
|---|---|---|
| AC1 With a panic planted in the matcher and a fail-closed rule that would apply, deep-hook exits 2 and prints a denial; on main it exits 101 | `#1407.3799f437` | `panic.test.ts`, 1 test |
| AC2 With the same plant and no fail-closed rule that applies, the call is allowed, as with the hub down | `#1407.055ae8d4` | `panic.test.ts`, 2 tests |
| AC3 A normal denial and a normal allow are byte-identical to before | `#1407.14eb6bf3` | `unchanged.test.ts`, 4 tests |

IDs: `#1407.` and the first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed; I hashed them
from the issue myself and they match the first draft's.

## What differs from the first draft

The first draft decides every criterion with its own `must()`, a plain `throw Error`. The proof lanes count a
failure only when it is the framework's own assertion thrown from a file under the test paths
(`scripts/proof-runs.mjs`, `atAssertion`), so on a wrong program none of its tests could prove a criterion, and its
in-test "wrong program" case for AC3 passes when its comparison throws, which the lanes can't read as proof either.
Here every criterion is decided by a vitest `expect` in the test file, and only setup and controls throw plain
`BLOCKED`/`INCONCLUSIVE` errors, so a broken setup never counts as proof. Also: AC2 and AC3 compare one object
`{exit, signal, stdout, stderr}` with `toEqual`; AC3 adds a normal allow with no fail_closed entry installed (the
hook's other path, where the watchdog isn't ruling); the base binary's sources are unpacked under
`target/base-2bba2a50/src` rather than `/tmp`, so a second run finds its build fresh; and both spool timing lines
are set aside, not one.

## How to run

```sh
CARGO_BUILD_JOBS=4 npx vitest run --root tests/acceptance/1407/redraft --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1407/redraft/tsconfig.json   # type-check
```

The tests build, with `nice -n 10 cargo build --locked -q -p deep-hook`: `target/debug/deep-hook` (plain),
`target/plant-matcher-panic/debug/deep-hook` (`--features plant-matcher-panic --target-dir
target/plant-matcher-panic`) and `target/base-2bba2a50/target/debug/deep-hook` (the base commit's sources from
`git archive 2bba2a50 Cargo.toml Cargo.lock .cargo crates vendor`, so the working tree, index and worktree list are
untouched). No hub, network or model. Every hook runs as Claude Code's entry runs it, `deep-hook claude-code
PreToolUse` with a Bash `PreToolUse` payload on stdin, in a temp `HOME` under `/tmp/dh1407r-*` holding only
`.deepbuild/rules.json`: nothing listens at the hub's address, so this is the hub-away path. Children get no
`DEEP_*`, `RUST_*`, `GIT_*`, `XDG_*`, `CLAUDE*`, `CURSOR*`, `CODEX*` or billing variables (no `RUST_BACKTRACE`
changes a panic's text, no `DEEP_HUB_PLANT` plants anything). Processes are stopped only by their own PID; temp
homes are removed after each test.

**Not decided, never passed.** A hook killed at its 60 s timeout, a cargo build killed at 30 minutes, and a plain or
base run that took 500 ms or more and was denied in the watchdog's words (the load decided it, not the rules) throw
`INCONCLUSIVE`. A build that fails, such as the plant's on the base, throws `BLOCKED`.

## The plant: `plant-matcher-panic`

The implementer adds this Cargo feature to `crates/deep-hook/Cargo.toml`; under it `Call::matches` (`matcher.rs`)
panics whenever it is called, on the thread that calls it, and nothing else changes. It is a Cargo feature only,
never an environment variable (#1408). On the base the feature doesn't exist, so every planted test is `BLOCKED`
there ("the package 'deep-hook' does not contain this feature"). That is not a failure at an assertion and proves
nothing by itself: the planted tests prove their criteria on the twin below.

## AC1

Rules: `t-closed`, fail_closed, `run:gh pr merge`; call `gh pr merge 12`. Control (plain error if it fails): the
unplanted build denies the call with exit 2 in t-closed's words, so the entry would apply. Then, on the planted
build, `expect`s:

- exit code **2** ("only exit 2 blocks the call"; on the base the panic exits 101);
- stderr, past the spool timing lines, starts with the watchdog's words **`DeepBuild blocked this: deep-hook
  couldn't read this call and check it against the guards`** (Scope: "using the same wording as the watchdog's";
  the rest of the line, such as "within 500 ms. Retry it.", is the implementer's);
- stderr holds no `panicked` or `RUST_BACKTRACE` (Rust's panic text);
- stdout holds no `"permissionDecision": "allow"`.

A planted run past 500 ms is judged, not set aside: the watchdog's words are the answer AC1 asks for. One risk: on a
wrong program that still exits 101, a run whose main thread didn't reach the matcher within 500 ms would be denied by
the base watchdog and pass. That needs the hook to stall half a second before matching; I saw nothing near it.

## AC2

Rules: `t-open` (`run:gh pr merge`) and `t-other` (`run:ls`), neither fail_closed; calls `gh pr merge 12` (matched
by an entry that isn't fail_closed) and `echo hello` (matched by nothing). Both entries are matched against each
call, so the plant fires either way. Each call runs on the plain build (control: exit 0) and then on the planted
build at the same paths with the same bytes, and `expect` requires `{exit, signal, stdout, stderr}` to equal the
plain build's: "allowed, as with the hub down" made exact (Scope: "a panic behaves as the hub-down path does
today").

Reading: "no fail-closed rule that applies" is tested as "no fail_closed entry installed". Once the matcher has
panicked, deep-hook can't know that an installed fail_closed entry doesn't apply; Scope's first bullet ("if a
fail-closed rule *may* apply") and the base watchdog (which denies a call it couldn't match while any fail_closed
entry is installed) make that a denial. So the suite asserts nothing about a panic with a fail_closed entry for a
different call. This is the first draft's reading too; I reached it from the base's watchdog.

## AC3

"Before" is the base commit's deep-hook built from its own sources; "now" is this checkout's plain build. Each case
writes its `rules.json` into a HOME, runs before, empties and rewrites the same HOME, runs now with the same payload,
and `expect` requires `{exit, signal, stdout, stderr}` equal:

| Case | rules.json | Call | Base |
|---|---|---|---|
| a normal denial | `t-closed` fail_closed `run:gh pr merge`, `t-open` `run:ls` | `gh pr merge 12` | exit 2, t-closed's denial |
| a normal allow, matched, fail_closed installed | same | `ls -la` | exit 0 |
| a normal allow, unmatched, fail_closed installed | same | `echo hello` | exit 0 |
| a normal allow, no fail_closed installed | `t-open` `run:gh pr merge` | `gh pr merge 12` | exit 0 |

Set aside on both sides, and only these: the spool's lines "deep-hook: spooled `<ULID>`, but its sync didn't finish
within the hook's 50 ms" and "deep-hook: could not spool `<ULID>` within the hook's 50 ms" (`main.rs`, `spool_by`).
Whether they print depends on the disk's timing, not the decision, and each carries a fresh ID, so the base differs
from itself on them under load. I saw the sync line myself: in the probe (BASE-FAILURE.txt) the unplanted base
printed "deep-hook: spooled 01M6TXDJSQRREZMY3DP5D1GDVF, but its sync didn't finish within the hook's 50 ms" on an
allow that took 29 ms in all, and the first draft's first base run failed base-against-base on it. AC2 sets the same
lines aside. The spool file under HOME holds the time and a fresh ID and isn't compared.

On the base AC3 compares the base with itself and passes: it is regression protection, and it proves its criterion
only on a twin (below) or by killing mutants.

## Wrong programs for `twins.json`

`twinsOf` reads `tests/acceptance/1407/twins.json` for every test under `tests/acceptance/1407/`, this folder
included; that file and its twin folders are outside this redraft, so here is what they need to name:

- **AC1 and AC2:** a twin that keeps the plant (the change's `Cargo.toml` and `matcher.rs`) and puts back the base's
  handling of a panic, such as the base's `crates/deep-hook/src/main.rs` with only the plant's lines kept if the fix
  lives there. Its planted build exits 101 with Rust's panic text, which is the issue's "on main it exits 101": AC1
  fails at `expect(r.code).toBe(2)` and both AC2 tests at the `toEqual`. I ran exactly that by hand
  (BASE-FAILURE.txt, the probe): the base plus the plant fails all three at those `expect`s.
- **AC3:** a twin that changes a normal decision's bytes in every case, such as `main.rs` printing one extra stderr
  line after every ruling. A twin that changes only the denial's words fails the denial case alone, and each of the
  four tests needs a twin it fails on.
