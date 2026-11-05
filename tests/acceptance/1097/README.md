# Acceptance tests for #1097: a call the guard can't read whole

Written first, blind, from issue #1097 (its text as of November 3, 2026, last edited 2026-11-03T04:49:19Z: the
statement, Scope, the 5 checkbox criteria, Proof and Depends on), the design sections it links ([Before each command],
[Threats, and what stops each one]) and the Dogfooding bullet, and base commit `fad1c4cb` (origin/main), by a job that
never saw an implementation of #1097. The base code read: `crates/deep-hook/` (`main.rs`, `matcher.rs`, `shell.rs`,
`default-rules.json`, `Cargo.toml`), `packages/hub/src/guards.ts`, `server.ts` (`reply`), `paths.ts` (`deepHook`),
`plant.ts`, `setup.ts` (`installRules`), and the suites of #304 and #316 for their conventions. The implementing agent
does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 5 checkbox criteria, AC1 to AC5 in the body's order. This suite covers all five.

## How to run

With the repo's Node (`.node-version`) and Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook
npx vitest run --root tests/acceptance/1097 --no-file-parallelism --testTimeout=600000
```

- `--no-file-parallelism`: each file builds deep-hook with cargo, which replaces the binary in place.
- No call is ever executed. The pushes, `pkill node`, `npm publish` and `"$CC"` are PreToolUse payloads deep-hook
  decides on, or planted calls the hub's install hands to deep-hook's check mode. Nothing needs the network or a model.
- Every test makes its own folders under `/tmp/dh1097-*` (a Unix socket path must fit in 104 bytes on macOS), sets
  `HOME` to one of them for every process it starts, and never touches the real `~/.deepbuild` or `~/.claude`. It
  stops only processes it started, by PID (`helpers.ts`, `cleanup`, `stopHub`), never by name or port.
- Builds: `target/debug/deep-hook`, `target/release/deep-hook` (AC5), the planted twin
  `target/plant-computed-misses/debug/deep-hook` (AC4), and the merge base's deep-hook (AC1, AC2) under
  `target/base-1097/<sha>/` (below). Nothing in the checkout changes.
- Type-check with `node node_modules/typescript/bin/tsc -p tests/acceptance/1097/tsconfig.json`. The tests reach the
  code only through the `deep-hook` binary, the `deep` CLI (`packages/cli/dist/main.js`) and files under `HOME`;
  nothing is imported from the packages, except the perf lane's `validateBudgets` from `scripts/benchmark.mjs`, as
  #304's budgets do.

## The surface under test

Each choice is the smallest the design and the base code support. The tests assert behaviour (allow or deny, which
entry is named, what reaches `rules.json`) and only the words the issue states.

### The entries

- **The fail_closed push entry (AC1).** The base ships no first-party `fail_closed` push entry: `authority-push`
  (`effect:push`) is watch-mode and not `fail_closed`. The test doesn't make one a default, which would change what
  every user's push does, beyond this issue. It installs `t-push` through `deep guard add` (#304's install), shaped
  as the first-party entries are: `effect:push`, `block`, `fail_closed: true`, planted call `git push origin main`,
  twin `echo 'git push origin main'`, beside the shipped defaults. An effect class rather than `run:git push`, since
  the issue names "an effect class's subcommand words such as `push`"; AC3 covers a `run:` entry's argument globs.
- **The kill-by-name entry (AC2)** is the shipped `no-kill-by-name` (`kill:by-name`, block, fail_closed), from
  `rules.json` seeded with `default-rules.json` verbatim, as #304's and #316's suites do.
- **The warn entry (AC3)** is `t-npm-publish`: `run:npm publish`, `warn`, not fail_closed, planted call `npm publish`,
  twin `echo 'npm publish'`, installed through `deep guard add`.
- **The fail_closed entry at install (AC4)** is the shipped `no-deep-off` (`run:deep off`, a match that names a
  program), taken verbatim from `default-rules.json` with its shipped planted call (`deep off`) and twin, so it is a
  first-party entry whichever way the implementer tells first-party entries apart, installed through `deep guard add`,
  the hub's one install path that runs check mode (#304). The test doesn't fix the computed-program form's
  spelling or where it is made (the hub or deep-hook's check mode).

### The calls

- AC1: `"$(printf git)" push origin main`, `G=git; "$G" push origin main` and `"$CC" -o app main.c`, verbatim.
  **A deviation from the issue's statement:** the issue says the base reads both programs as empty, but the base
  reader keeps the variables a line sets, so it reads `G=git; "$G"` as `git`: base `deep-hook check` says
  `effect:push` matches `G=git; "$G" push origin main` (`{"matched":true}`) and doesn't match
  `"$(printf git)" push origin main` (`{"matched":false}`). So the test holds `G=git; "$G" push origin main` to the
  criterion's denial by the push entry, hub up and stopped, but not to naming an unreadable program, which a reader
  that reads it whole has none of. The wrong-program half asserts the merge base allows `"$(printf git)" push origin
  main` and fails naming it. The issue's own words were kept for the calls; a redraft, or an issue edit that swaps in
  a line the reader can't know (such as `"$G" push origin main` with `G` unset), can tighten this.
- AC2: `pkill node` inside `sh -c "…"` 13 times over (`helpers.ts`, `nested`), each level escaping `\`, `"`, `$` and
  backquote with a backslash, so the line grows linearly (single quotes would grow it 4ⁿ). The outermost `sh -c`'s
  script is read at depth 1, so `pkill node` sits at depth 13, one past `shell.rs`'s `DEPTH` of 12. The same line
  12 deep is asserted denied too, as the control that the construction is the nesting the reader counts.
- AC3: `"$NPM" publish`, verbatim.

### How a decision and its words are read

As #304's suite reads them: exit 2 or a deny decision denies, exit 0 with no deny allows (`decision`); a deny's words
are everything the reply says (stdout and stderr, `told`); a warn's are Claude Code's
`hookSpecificOutput.additionalContext` (`contextFor`).

- **Which entry denied** (AC1, AC2): the denial names it (the base's denials, hub up and down, end `(guard <name>…)`).
- **Naming the unreadable program** (AC1): the denial contains the program as the line writes it, `$(printf git)`
  (with or without the quotes around it). Required with the hub up and stopped, since the Scope says the
  deny says what couldn't be read. Nothing else of the wording is asserted, not even the "write it out plainly" half.
- **Nests past what the reader reads** (AC2): the denial matches `/nest(s|ed|ing)? past|depth/i`.
- **"couldn't be read"** (AC3): the issue's phrase, with a straight or typographic apostrophe, in the context the agent
  is told, beside the entry's own reason.

### The hub up, the hub stopped

"Up" is `deep hub run` on the test's home; "stopped" is that hub stopped by its PID (SIGTERM), so deep-hook gets no
answer and applies the `fail_closed` entries (the design's "With the hub down"). AC1 and AC2 run every call in both,
as the Proof asks. AC3 runs with the hub up only: a warn is the hub's, and with it down deep-hook applies only
`fail_closed` entries. AC4's installs run with the hub up, as every install does.

### The install's deep-hook (AC4): `DEEP_HUB_TEST_DEEP_HOOK`

The base hub runs check mode with `paths.ts`'s `deepHook()`, the newer of the checkout's `target/release` and
`target/debug` builds, so no test can hand it a planted twin. AC4 needs the install to run an engine that misses
computed programs, so the hub takes **`DEEP_HUB_TEST_DEEP_HOOK=<path>`**, a test-only setting like
`DEEP_HUB_TEST_CONFIRM`: the deep-hook binary whose check mode the install runs. Only tests set it. The control
install runs without it, with the hub's own deep-hook.

### Budgets (AC5)

"Compared with the merge base" is the perf lane's comparison, as for #304: `benchmarks/budgets.json` must have a task
whose `initialReason` (or `changeReason`) names `#1097`, timing the hook path on calls with unknowns; the file must
pass `validateBudgets` against the merge base's, and the task's command must run and exit 0. The 2 ms is judged in the
test, on the release build: for `"$(printf git)" push origin main` and the 13-deep line (`G=git; "$G"` isn't an
unknown to the reader, above), the p95 of a forwarded
PreToolUse with `rules.json` holding the shipped defaults and `t-push`, minus the p95 of the same call from a home
whose `rules.json` is empty and whose address is the same hub, under **2 ms**. Five runs of 200 calls per line and
home, interleaved, each call timed from spawn to exit. Before any number is read, each timed call is proven to be
read as an unknown (denied with every entry). The timing rule is #304's: PASS when all five runs are within the limit,
FAIL when all are over it by more than the margin, otherwise INCONCLUSIVE; the readings count only on a reference Mac
(Mac15,7 M3 Pro 36 GB or Mac15,12 M3 16 GB) on mains power, Low Power Mode off, thermals nominal and the 1-minute
load within the core count. Anywhere else the test is **skipped as INCONCLUSIVE with the readings**, never passed.

## Wrong programs

| Name | How it is selected | Criterion | What it is | How the test fails on it |
|---|---|---|---|---|
| the merge base | deep-hook built from the pinned commit `fad1c4cb` (`helpers.ts`, `BASE`, `buildBase`) | AC1, AC2 | the base reader: a computed program reads as empty and meets no entry; a nesting past depth 12 is dropped | the computed push is allowed: "`"$(printf git)" push origin main` must be denied with the hub up"; the 13-deep line is allowed: "… past the reader's depth of 12, must be denied" |
| `unknown-as-block` | `DEEP_HUB_PLANT=unknown-as-block` | AC3 | the hub decides a warn entry the call met only through an unknown as it decides block | `"$NPM" publish` is denied: "t-npm-publish in warn mode meeting `"$NPM" publish` must allow it" |
| `plant-computed-misses` | cargo feature on deep-hook, built into `target/plant-computed-misses/debug/deep-hook`, handed to the hub as `DEEP_HUB_TEST_DEEP_HOOK` | AC4 | the reader of the fix, except that a program the line computes reads as empty and meets no entry, as on the base | not a wrong program the test must fail on, but the engine under which the computed form is allowed; the install must refuse `no-deep-off`. A hub that never runs the computed form, or ignores `DEEP_HUB_TEST_DEEP_HOOK`, installs it and fails "must refuse the entry, exit 1" |

- **The merge base is pinned, not computed.** The issue names "deep-hook on the merge base" (AC1) and the Proof has the
  deep nesting shown failing on it; the base reader is exactly "a reader that stops at its depth and allows the call"
  (AC2), so no planted twin is needed for either. It is pinned to `fad1c4cb` so it stays the pre-fix reader after
  #1097 merges and `git merge-base` moves past it. `buildBase` takes `crates/deep-hook` and `crates/deep-contracts`
  (deep-hook's one dependency; neither uses a crate from outside the repo) from that commit with `git archive` and
  builds them offline in a workspace of their own, kept under `target/base-1097/<sha>/`.
- The hub plant and the cargo feature are the implementer's to write. Until then (the base), the hub refuses to start
  on the unknown plant value and the feature build fails, so those tests fail BLOCKED, never pass.

## Criteria to tests

Each `describe` names its criterion's ID, `#1097.<first 8 hex of SHA-256 of the criterion's text>` (trimmed,
whitespace collapsed, `- [ ] ` dropped, as `scripts/proof-change.mjs` computes it). Each test's name starts with its
criterion's number.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#1097.35142c93` | hub stopped, the fail_closed push entry installed: both computed pushes denied naming the program, `"$CC" -o app main.c` runs; the merge base allows both and fails, naming the call (see The calls for `G=git`) | `computed.test.ts` AC1 (2): the calls, hub up and stopped; the merge base |
| AC2 `#1097.68b4ff24` | `sh -c` 13 deep around `pkill node` denied by kill-by-name, saying it nests past the reader; a reader that stops at its depth and allows fails, naming the depth | `depth.test.ts` AC2 (2): the line (and its 12-deep control), hub up and stopped; the merge base |
| AC3 `#1097.cd061f3b` | warn `run:npm publish` meeting `"$NPM" publish` allows it and tells the reason with "couldn't be read"; unknown-as-block fails, naming the entry | `warn.test.ts` AC3 (2): the call; the plant |
| AC4 `#1097.818d5af2` | an install whose computed-program form of a fail_closed entry's planted call is allowed refuses the entry, naming it | `install.test.ts` AC4 (1): the control install, then the refused one |
| AC5 `#1097.a5ceefc6` | matching with unknowns under 2 ms at p95 on the hook path, vs the merge base | `budgets.test.ts` AC5 (2): the perf lane task; the timed calls |

## What this suite leaves open

- **Watch mode** ("a watch or warn entry only records it") has no criterion; only warn is tested (AC3).
- **"Writing the command out plainly lets it be read"** is in the Scope's deny bullet but no criterion; it isn't asserted.
- **The first-party push entry.** If the implementer adds a shipped `fail_closed` push entry, AC1 still installs
  `t-push`; a redraft could switch to the shipped one.
- Under heavy machine load a hook can miss the hub's acknowledgement and fall back to the hub-away decision (#315). A
  hub-up assertion that fails that way (AC3's warn in particular) shows the call's time in its message; the tests do
  not retry or loosen for it.

## Files

- `helpers.ts`: temp homes, the defaults seeded as the first `rules.json`, test entries and guard files, `deep guard
  add`, deep-hook built plain, as a twin or from the pinned merge base, run as a hook entry, the hub as a process, the
  nested line, and the timing tools. Adapted from #304's.
- `computed.test.ts` (AC1), `depth.test.ts` (AC2), `warn.test.ts` (AC3), `install.test.ts` (AC4), `budgets.test.ts` (AC5).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion and reason.

[Before each command]: ../../../docs/technical-design.md
[Threats, and what stops each one]: ../../../docs/technical-design.md
