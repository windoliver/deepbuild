# Acceptance tests for #2695: the guard entries' proofs move out of rules.json

Written first, blind, from issue #2695 (body last edited 2026-11-22T00:02:07Z: its report, Scope, six checkbox
criteria, Proof line and dependency; no comments), the design sections it links ([Hook protocol (deep-hook and the
hub)], [Before each command], [Numbers version 0 has to hold]) and How we know version 0 works (Wrong programs,
Dogfooding), `AGENTS.md`, and base commit `512d194bb` (origin/main), by a job that never saw an implementation; none
existed, and no other branch, worktree, pull request or session's notes were read. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 after `deep setup`, rules.json holds no proof; the proofs' file holds all 31, each equal to the merge base's | `#2695.5cc60b5e` | `setup.test.ts` (1) |
| AC2 a forwarded PreToolUse opens the proofs' file zero times, and retires >= 0.3 M fewer instructions than the merge base for a Read over 15 alternated rounds | `#2695.7026a58e` | `hook.test.ts` (2: opens; instructions); opens' wrong program in `twins.json` |
| AC3 an entry with no planted call, and one whose twin it denies, are each refused, naming it; a planted install that checks no proof fails | `#2695.d791b61b` | `install.test.ts` (2, one per refusal); the planted install in `twins.json` |
| AC4 a rules.json an older hub wrote, proofs in it, matches every call as the merge base does; after the next install the proofs are in their own file, none lost | `#2695.af072e8f` | `older.test.ts` (2: matching; the install); matching's wrong program in `twins.json` |
| AC5 the proofs' file missing or unreadable: every guard holds, and `deep doctor` shows one item naming it; a planted hook that turns its guards off then fails | `#2695.f70c83fe` | `missing.test.ts` (4: hook and doctor, for missing and for unreadable); the planted hook in `twins.json` |
| AC6 `tests/acceptance/316/`, `344/`, `1856/` and `2204/` pass unchanged | `#2695.a2e93b2e` | none here (below) |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text in the live issue body. Each test's name
starts with its ID, and each test is its own top-level `test()`, with no subtests. Every criterion is decided by a
vitest `expect` in the test files; setup and controls throw plain `BLOCKED` or `INCONCLUSIVE` errors (`helpers.ts`), so
a broken setup or a loaded machine is never read as proof.

**AC6 has no test here.** As `tests/acceptance/1881/README.md` does for its "#85's suites pass unchanged", this job
writes no test for a criterion that is another folder's suites passing: those four folders are run unchanged by the
implementer, and their results are the proof.

## What was read

- The issue, and the audit it links (`reports/hillclimb-audit-2026-11-09/05-rust-runtime.md`) for what the hook reads.
- `docs/technical-design.md`: the three linked sections; Numbers version 0 has to hold (instructions retired, a
  budget counted in instructions runs its sides in pairs, each round swapping which runs first; a count that can't be
  read is missing, never 0); How we know version 0 works: Wrong programs, Dogfooding. `AGENTS.md`.
- At the base, for surfaces only: `crates/deep-hook/src/main.rs` (`rules`, `forward`, `spool`, `matching`, `check`),
  `crates/deep-hook/default-rules.json` (38 entries, 31 proofs), `crates/deep-hook/Cargo.toml`;
  `packages/hub/src/guards.ts` (`addGuards`, `provenGuards`, `rewriteRules`), `setup.ts` (`installRules`,
  `builtHook`), `doctor.ts` (`doctorCommand`, items), `packages/cli/src/main.ts` (how `guard` and `doctor` run);
  `packages/contracts/schemas/tool.before@4.json`; `benchmarks/process-reader.mjs` (`readCommand`: instructions by
  `/usr/bin/time -l`); `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (`twinsOf`, twins laid
  before the build).
- Suites `2204/` and `1856/` (house format, twins), `1998/` (a real `deep setup` in a temp HOME: the launchd stand-in
  and stubs, copied into `fixtures/`), `1097/` and `304/` (guard install helpers, the merge base's deep-hook built
  from `git archive`), `2694/` and `2648/` (how an instruction count is read and gated), `1881/` (the AC6 precedent).

## The surface

The real `deep setup` (`node packages/cli/dist/main.js setup`) in a temp HOME under `/tmp/dh2695-*`, with #1998's
stand-ins first on PATH: `launchctl` (`fixtures/launchd.mjs`, which starts the hub as launchd would), `systemctl`,
`claude` and `codex` (`fixtures/stub-bin.sh`, which log and exit 0), and a login shell that reads no profile; the OS
confirmation is stubbed through `DEEP_HUB_TEST_CONFIRM`, as #304's and #1998's suites do. Setup writes its hooks only
into that temp HOME. The real hub (started by setup's login service, or `deep hub run` for the older home), the real
`deep guard add` and `deep doctor --json`, and the real deep-hook run as Claude Code's hook entry runs it,
`deep-hook claude-code PreToolUse` with a payload on stdin. The record is read through the hub's socket as the cli
role (`events.read`). Nothing is imported from the packages and nothing stands in for the hook, the hub or setup.

Three deep-hook builds: this checkout's `target/debug/deep-hook` (`cargo build --locked -q -p deep-hook`, the one
setup names in the hooks it writes), its `target/release/deep-hook` (AC2's instructions only), and **the merge
base's**, release: `crates/deep-hook`, `crates/deep-contracts` and `Cargo.lock` at the pinned `BASE` (`512d194bb`)
taken by `git archive` and built offline under `target/base-2695/`, as #1097's suite does. Pinned, so after #2695
merges "the merge base" is still the hook whose rules.json holds the proofs.

## Readings where the issue leaves a choice

- **The proofs' file is `~/.deepbuild/proofs.json`.** The issue never names it. This suite takes the natural name
  beside `rules.json` and uses it in every test and twin, rather than finding the file by its content: AC2 counts
  opens of the file and AC5 removes it and asks doctor to name it, and both need the one path before the change has
  written it; a content search can't find a file that is a FIFO, missing or unreadable, and on the merge base there is
  no such file at all, so a test that searched would be BLOCKED there instead of failing. The implementer, who reads
  these tests first, names the file so. Its shape isn't held: its `proofs` member when it has one, else its own
  members other than `v`, are the proofs, by entry name.
- **"rules.json holds no proof".** No key `proofs` anywhere in it, and no member `planted` or `twin` anywhere in it
  (`proofKeys`). Its entries, classes and other members are free; AC4 also asks that every entry is still there.
- **"Each equal to what the merge base wrote".** The merge base's setup writes its `default-rules.json` into rules.json
  (`installRules`), proofs verbatim, and no hub rewrite touches them; so each proof is compared, as JSON with keys
  sorted, with that file's at `BASE` (`git show`). The 31 are counted from it.
- **"After `deep setup`".** Setup has exited 0 and its hub answers; the hub's own first writes get 15 s to land.
- **AC2, "opens the proofs' file zero times, counted by the test".** The file is replaced by a FIFO
  (`countOpens`). A reader's open of a FIFO blocks until a writer opens it, and the test's non-blocking open of the
  write end succeeds only then, so each open by any process is counted. "A forwarded PreToolUse" is read as the call as a whole, so an open by
  the hub while it handles the call counts too. 15 calls in a home setup made, its hub running: a Read and
  `git status`, in turn. Precondition: the record holds a `tool.before` for at least one of them (forwarded).
- **AC2, "at least 0.3 M fewer instructions for a Read, over 15 alternated rounds".** Each side is a deep-hook,
  release (as shipped), run under `/usr/bin/time -l`, which reports the process's instructions retired (macOS only;
  elsewhere INCONCLUSIVE, never a pass). The change's side runs in the home `deep setup` made; the merge base's side in
  a second home with the same top-level files (config, setup-finished, generations: what deep-hook reads) but rules.json
  as the merge base has it, proofs in it, and no proofs' file (`baseSideOf`). Both homes' `hub.address` names the one
  hub setup started, so the same hub answers both and only the rules files differ. Each round runs both, the side
  that runs first swapping every round. A call the hub didn't answer in time is spooled, which costs instructions of its
  own; a round counts only when both sides took the same path, up to 60 tries for 15, else INCONCLUSIVE. The verdict
  is the median over the 15 rounds of (merge base minus change), which must be at least 300,000. There is no load
  gate: the count is instructions, not time, and the design counts them "off the reference Macs and under load".
- **AC3, "refused as today, naming the entry".** `deep guard add` exits 1 (refused, as today), its output names the
  entry, and the entry isn't in rules.json after. The two entries are `frob-2695-no-planted` (a twin, no planted call)
  and `frob-2695-twin-denied` (match `run:frob2695b`, twin `frob2695b --dry-run`). Control first, in the same home: a
  whole entry installs, so a refusal is the entry's own.
- **AC4, "a home whose rules.json still holds proofs, as an older hub wrote it".** The merge base's
  `default-rules.json`, verbatim, as rules.json, with a `setup-finished.json` (`olderHome`); no proofs' file.
- **AC4 and AC5, "matches every call as the merge base does" / "as before".** Every planted call and twin of the 31
  proofs (102 calls) is made as a PreToolUse with no hub answering, so deep-hook decides alone: its decision, and the
  entries it matched, read from the line it spooled (`matched`, what it sends the hub), must equal the merge base's
  deep-hook's on the same home. With the hub away a call's guards are deep-hook's alone, and the spooled `matched`
  shows the entries of every mode, not just the fail_closed ones that decide. For AC5 the merge base's reading is taken
  on the home before the file is spoiled (that hook never reads it), so "as before" doesn't depend on the program
  under test having been right before.
- **AC4, "after the next install … none is lost".** A hub started on the older home, then `deep guard add` of a whole
  entry `frob-2695-next`; rules.json then holds no proof and every entry, and the proofs' file holds every merge-base
  proof and the new one, each unchanged.
- **AC5, "missing or unreadable".** After setup the hub is stopped by its PID, then the file is removed, or made mode
  000. Doctor runs with the hub stopped, so no hub can put the file back first. "Shows one item naming the file":
  exactly one of `deep doctor --json`'s items holds `proofs.json` in any field, and its level is `warn` or `fail` (it
  needs you). Its item name, code and words are the implementer's.

## Not covered here

- AC6 (above).
- Scope lines with no criterion: the proofs' file's mode and sync (only its content is held), and the design's line.
- An unreadable proofs' file other than mode 000 (cut short, not JSON).
- A Windows home (`%LOCALAPPDATA%\DeepBuild`).

## Files

- `helpers.ts`: homes, setup, the hub, hooks, the builds, the record, the FIFO counter, instruction counts, doctor.
- `setup.test.ts` (AC1), `hook.test.ts` (AC2), `install.test.ts` (AC3), `older.test.ts` (AC4), `missing.test.ts` (AC5).
- `fixtures/launchd.mjs`, `fixtures/stub-bin.sh`: copied unchanged from `tests/acceptance/1998/fixtures/` (same repo,
  same license), the launchd stand-in and the stubs.
- `twins.json`, `twins/` (its README says what each changes), `BASE-FAILURE.txt`, `tsconfig.json`.

## Run them

```sh
source ~/.nvm/nvm.sh && nvm use 24                    # Node 24
npm ci && npm run build --workspaces                  # once: the hub, setup and the deep CLI the tests start
cargo build --locked -q -p deep-hook                  # warm; each file runs its builds again, a no-op when fresh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2695 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2695/tsconfig.json   # type-check
```

macOS only: setup is run against the launchd stand-in, and elsewhere it would reach the real service manager
(BLOCKED). Each file builds what it needs once (`target/debug`, and for AC2 `target/release` and the merge base's
under `target/base-2695/`); never run cargo beside a run of these files. Each file makes its own homes and hubs, stops
them by PID, and removes its folders after. Run the files one at a time (`--no-file-parallelism`): they each start
hubs and many hook processes.

## Base results

`BASE-FAILURE.txt` holds the one whole run at the base (11 tests: 5 fail, 6 pass, none blocked or inconclusive;
52 s at load average 57) and the twins' runs. The checkout's built packages were older than its sources, so every
run was made in a copy of HEAD under /tmp with the packages built there (`BASE-FAILURE.txt`, its header).

| Test | On the base | On its twin |
|---|---|---|
| AC1 (`setup.test.ts`) | fails at its assertion, naming the key: rules.json holds `proofs` | |
| AC2 opens | passes (the base hook never opens `proofs.json`) | `guards-off-without-proofs`: fails, opened 15 times |
| AC2 instructions | fails at its assertion: median 20,331 fewer (the base against itself), 300,000 needed | |
| AC3 no planted call | passes (refused, as today) | `installs-without-proofs`: fails, exit 0, `Added frob-2695-no-planted` |
| AC3 twin denied | passes (refused, as today) | `installs-without-proofs`: fails, exit 0, `Added frob-2695-twin-denied` |
| AC4 matching | passes (the same hook) | `old-rules-refused`: fails, all 102 calls differ, each named |
| AC4 install | fails at its assertion, naming the key: rules.json still holds `proofs` | |
| AC5 hook, missing | passes | `guards-off-without-proofs`: fails, 48 calls differ, each named |
| AC5 hook, unreadable | passes | `guards-off-without-proofs`: fails, 48 calls differ, each named |
| AC5 doctor, missing | fails at its assertion: no item names `proofs.json` (its 27 items listed) | |
| AC5 doctor, unreadable | fails at its assertion: no item names `proofs.json` | |

**What the counts look like.** A release deep-hook's forwarded PreToolUse for a Read retired about 23.7 to 25.7 M
instructions here (most of it process start), and an earlier run read a second mode near 33 M in some calls of either
side. The 0.3 M asked for is about 1.3% of a call, so the verdict is the median of the paired differences, which one
side's outlier round doesn't move; the base against itself read medians of 20,331 and -16,996 in two runs. Whether
moving 9.9 KB of proofs out saves 0.3 M in a release build is the issue's drafted number (from the audit's 0.3 to 1 M);
if the change's honest saving is below it, that is a dispute about the number, not about this test.

## What this job could not prove

- No test can pass here: no implementation exists, so none of the five failing tests was seen passing, and the
  FIFO count and the doctor reading were never seen on a program that passes them.
- AC2's instruction test was run on the base only; its twin column is empty because the base fails it.
