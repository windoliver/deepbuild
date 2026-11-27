# Acceptance tests for #3421: deep-hook reads the hub's acknowledgement and reply through the generated types

Written first, blind, by a job that never saw an implementation of #3421, from:

- issue #3421, its text as of November 25, 2026: the opening paragraphs, Scope, the 4 checkbox criteria, Not in scope,
  Proof and Depends on. It has no comments.
- the design section it links, [Hook protocol (deep-hook and the hub)], and "How we know version 0 works" (Dogfooding,
  and its Repo guards bullet on blind suites: a saved run record writes home folders as `~`, and a test waits for its
  event, never for time). The budget rules are [Every task carries its own budgets] and [The reference Macs].
- AGENTS.md (Proof, Machine and safety).
- base commit `4d8baa118` (origin/main). There I read `crates/deep-hook/src/main.rs` (the exchange with the hub, as the
  issue cites it), `packages/contracts/schemas/hook.ack@2.json` and `hook.reply@2.json`, `crates/deep-contracts/README.md`
  (the regeneration command), `benchmarks/budgets.json`, `scripts/benchmark.mjs` and `scripts/perf.mjs`, the proof
  scripts that read a suite (`scripts/proof.mjs`, `proof-runs.mjs`, `proof-change.mjs`, `lanes-lists.mjs`,
  `wait-ratchet.mjs`), and the suites `tests/acceptance/316/` (whose calls AC1 names), `315/` (its stand-in hub),
  `3257/` (a pinned merge base built from `git archive`), `999/` and `1832/` for their conventions.

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft by this job.

The issue has 4 checkbox criteria, AC1 to AC4 in the body's order. AC1, AC2 and AC3 each have one tagged test. **AC4
has none**, and why is under [AC4](#ac4-the-two-budgets-no-test-here).

## How to run

With the repo's Node (`.node-version`, 24.22.0) and Rust toolchain (`rust-toolchain.toml`), from the repo's root:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # recorded.test.ts starts real hubs from packages/cli/dist
node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/3421
node node_modules/typescript/bin/tsc -p tests/acceptance/3421/tsconfig.json   # type-check
```

- The files build deep-hook themselves with `cargo build --locked -q -p deep-hook`: this checkout's in the checkout's
  own `target/`, and the merge base's and the scratch checkout's in one target folder they share,
  `target/acceptance-3421/target`, so the registry crates compile once for both. Each of those two binaries is copied
  out as it is built (`target/acceptance-3421/deep-hook-base`, `deep-hook-scratch`), since the next build replaces the
  folder's `debug/deep-hook`. The folder takes about 0.4 GB and is safe to delete. `lane.json` runs the folder alone.
- Nothing needs the network. A stand-in hub is this test process listening on a temp home's own socket; the real hubs
  are `deep hub run` on temp homes.
- Every test makes its folders under `/tmp/dh3421-*` (and #316's helpers under `/tmp/dh316-*`): a Unix socket path must
  fit in 104 bytes on macOS. `HOME` is one of them for every hook and hub, so the real `~/.deepbuild`, `~/.claude` and
  `~/.codex` are never touched. cargo, git and npm keep this process's environment without its `GIT_*` settings; npm
  gets a temp home too. No process is stopped by name or port: a hook that hangs is killed by its PID at its timeout,
  and the hubs are stopped by PID by #316's `stopHub`.
- No test waits for time to pass. The only timer bounds a child's run.
- On the base commit, on a Mac with 8 cores and other sessions' work beside it: at a one-minute load of 9 to 13,
  `lines.test.ts` 2 s, `recorded.test.ts` 11 s with its builds warm, `scratch.test.ts` 42 s cold; at a load of 57 to
  116, the whole folder 93 to 102 s (`recorded.test.ts` 14 s, `scratch.test.ts` 77 to 86 s). See `BASE-FAILURE.txt`.

## The surface under test

- **The hook**: the `deep-hook` binary, run as an agent's hook entry runs it, `deep-hook claude-code PreToolUse` with
  Claude Code's hook JSON on stdin. Its reply is what the agent reads: the exit code and the bytes of stdout and stderr.
- **The stand-in hub** (AC2, AC3): a listener on the temp home's `~/.deepbuild/hub.sock`, the address deep-hook reads
  with no setting. It writes a hello line as #315's test hub does, reads the request, and writes back the lines a test
  plants, in one write. It is never the hub under test.
- **The spool**, `~/.deepbuild/spool/*.jsonl`: with the hub away deep-hook spools its request, and marks it `late` when
  the hub was there but late (design, Hook protocol).
- **The schema and the generator** (AC3): `packages/contracts/schemas/hook.reply@2.json`, and the repository's own
  command that writes the Rust from the schemas, `npm run generate -w @deepbuild/contracts`
  (`crates/deep-contracts/README.md`).
- **#316's suite** (AC1): `tests/acceptance/316/helpers.ts`, imported as that suite's own corpus file imports it.

## Readings where the issue and design leave a choice

### "#316's recorded calls" (AC1)

#316's suite keeps no file of calls. Its calls are written in its test files, and its corpus is generated in
`corpus.test.ts` from seeds, by code that file doesn't export. This suite reads "#316's recorded calls" as **the calls
#316's suite holds in its files**, 49 in all:

- every call its AC1 to AC8 tests make (`blocked.test.ts`, `git.test.ts`, `config.test.ts`, `dispatch.test.ts`,
  `symlink.test.ts`), in the worlds those files make: a plain session, a session in a real git worktree beside a second
  worktree and the main checkout, a session beside agent config files and a skills folder, and a session whose
  `~/.claude/settings.json` is a symlink;
- from `corpus.test.ts` and `CORPUS.md`, each default entry's planted call (`pkill -f node`, `git stash`,
  `gh workflow run deploy.yml --ref main`, `git -C <main> status`, `sed -i s/a/b/ ~/.claude/settings.json`) and the
  four mention shapes the corpus always holds (the words as an argument, a quoted string, a comment and a heredoc
  written to a file).

The 5,000 seeded respellings are not replayed: their generator isn't part of #316's exported surface, and they differ
from these calls only in how the shell line is spelled, which the matcher reads and this issue doesn't touch. If the
owner means the seeded corpus, this is the point to redraft.

The calls go through #316's own surface: `makeHome`, `installDefaults` (the shipped default entries as `rules.json`),
`newSession`, `bash`/`edit`/`write`, `makeRepo`/`addWorktree`/`gitDirOf`, `link`, `hook`, and `startHub`/`stopHub`.

**Both ways #316 runs them.** Each call is made with the hub stopped (no hub at the address, as #316's AC1 to AC8 run)
and with a real hub up (`deep hub run`, as its corpus's second pass runs). Only with the hub up does deep-hook read an
acknowledgement and a reply, the two lines this issue changes the reading of. The test also requires that at least one
reply with the hub up is the hub's own and not the call's hub-stopped reply, or nothing shows those lines were read.
On the base 31 or 32 of the 49 are.

**"The merge base's."** The merge base is pinned: `4d8baa1189968d95871417134c711e08918532c3`, the commit this suite was
written on, as #3257's suite pins its own. Its Cargo workspace is exported with `git archive` (no `.git` is copied) and
its deep-hook built beside this checkout's. Both binaries make each call in one world: the same home, session, folders
and hub.

**"Byte for byte", on a machine whose timing moves.** One binary's reply to one call can take more than one form:

- with the hub up, a busy hub can miss the 20 ms it has to acknowledge, and deep-hook then answers as with the hub
  stopped;
- with the hub away, deep-hook adds a line of its own to stderr when a busy disk didn't sync the spooled request in the
  hook's time, and that line names the event's ID, which deep-hook mints anew at each run.

So the two binaries make each call in turn, up to eight rounds, until a reply of one is byte for byte a reply of the
other. With the hub up, once either binary has shown the hub's own reply, only the hub's own reply counts as agreed,
so a hook that never takes the hub's answer can't agree through a round where the other was late. A ULID in a reply is
compared as a ULID, not by its characters. A call with no agreed reply after eight rounds fails the test, and the
failure names the call and where the bytes first differ.

### "Reads as the hub away" and "prints none of its bytes" (AC2, AC3)

- **Reads as the hub away**: the hook's exit code and stdout are the ones the same binary gives the same call with no
  hub at the address, byte for byte; and the request is in the spool with no `late` mark, so the line was read inside
  the hub's time and refused, not waited out. stderr is not compared whole, for the spool line above.
- **Prints none of its bytes**: every string the stand-in writes carries a random marker (the fourth key's value, the
  other request's ID, each `stdout` and `stderr`), and no marker is in the hook's stdout or stderr.
- **An acknowledgement the hook must refuse** is followed at once by a reply that holds to `hook.reply@2`, with exit 3
  and markers on both streams. A hook that took the acknowledgement prints that reply.
- **"Another request's ID"** is a well-formed ULID no request of the test carries.
- **A run that says nothing is run again.** On a busy machine the stand-in can miss the 20 ms it has to acknowledge.
  The spool then marks the request `late`, and that run says nothing about the planted line. Such a run is made again,
  up to 40 times, until one shows the line read in time. If none does, the test fails saying so; it never passes on a
  run it can't read.
- **The control.** Before the six lines, the same stand-in writes the design's own acknowledgement and reply, and the
  hook must take them: exit 3 and both streams, byte for byte. Without it the six would pass against a stand-in no
  hook ever heard.

### The scratch checkout (AC3)

A copy of this checkout as its files are, at `target/acceptance-3421/scratch`: the Cargo workspace (`Cargo.toml`,
`Cargo.lock`, `rust-toolchain.toml`, `crates/`, `vendor/`, and `adapters/`, which deep-hook's sources read at build
time), `packages/contracts`, and the root `package.json` and `tsconfig.json` its generator's build reads, with
`node_modules` a link to this checkout's. Files are cloned where the disk can, so the copy takes little room. It is not
a git checkout: the criterion needs the files, the generator and a build, and none of them reads git. The path is the
same every run, so cargo rebuilds only deep-contracts and deep-hook.

There, and only there, the test sets `properties.exit.maximum` to 100 in `hook.reply@2.json`, runs
`npm run generate -w @deepbuild/contracts`, and builds deep-hook. It checks, in this order:

1. the generator exits 0 and `crates/deep-contracts/src/generated.rs` changed;
2. every file under the scratch checkout's `crates/deep-hook/src` is this checkout's, byte for byte ("with no edit
   under `crates/deep-hook/src`");
3. the scratch hook builds;
4. the control: it still takes a reply with `exit` 100, the highest the edited schema allows, so a hook that refuses
   every reply, or one the stand-in never reached in time, can't pass;
5. the criterion: it refuses a reply with `exit` 200, which reads as the hub away, with none of its bytes printed.

The frozen digest of `hook.reply@2` in `packages/contracts/digests.json` no longer matches the edited schema. The
generator doesn't refreeze it and doesn't check it, so the edit needs nothing else; the contract test that would
object isn't run in the scratch checkout.

## Criteria to tests

Each test's name starts with its criterion's ID, `#3421.<first 8 hex of SHA-256 of the criterion's text>` (trimmed,
white space collapsed), as the trace lane reads tags. No tagged test has subtests.

| ID | Criterion (short) | Test | On the merge base |
|---|---|---|---|
| AC1 `#3421.8b9bca28` | deep-hook's replies for #316's recorded calls are byte for byte the merge base's; a reply that differs in one byte fails, naming the call | `recorded.test.ts`: "deep-hook's replies for #316's recorded calls are byte for byte the merge base's, with the hub stopped and with it up" | **passes** (the two binaries are one source) |
| AC2 `#3421.7b68a484` | each of six lines from a stand-in hub reads as the hub away, and the hook prints none of its bytes | `lines.test.ts`: "each of the six lines reads as the hub away, and the hook prints none of its bytes" | **passes** (the hand checks refuse all six) |
| AC3 `#3421.bd1a37c9` | in a scratch checkout, `exit`'s maximum lowered to 100 and the Rust regenerated makes the hook refuse `exit` 200, with no edit under `crates/deep-hook/src` | `scratch.test.ts`: "with exit's maximum lowered to 100 in a scratch checkout and the Rust regenerated, the hook refuses a reply with exit of 200, with no edit under crates/deep-hook/src" | **fails**, at its last assertion: the scratch hook takes the reply (exit 200, both streams printed) |
| AC4 `#3421.ceafdcd9` | `deep-hook-overhead` and `hub-round-trip` stay within their budgets, read before and after on one machine | none here | see below |

AC2's six lines are the issue's, exactly: an acknowledgement with a fourth key; one whose `ack` is another request's
ID; one with `hold_until_ms` of -1; a reply with `exit` of 256; a reply with no `stderr`; a reply with `v` of 2.

## Wrong programs

AC3 fails on the merge base at its assertion, as the criterion says ("On the merge base the hook still takes that
reply, which fails this"), so it needs no twin. AC1 and AC2 pass on the merge base, so each needs a planted twin: line
overlays on the change (`twins.json` and `twins/<name>/lines.json`, in #1832's line form). **The twins are not written
here**: their lines are the change's, which this job hasn't seen. A separate blind job writes them once the change
exists. What each must be, in words:

| Criterion | The wrong program | How the test fails on it |
|---|---|---|
| AC1 `#3421.8b9bca28` | A hook that changes one byte of a reply it takes from the hub: for instance one that prints the reply's `stdout` or `stderr` with a byte added, dropped or changed, or exits with another code than the reply's `exit`. (The criterion: "A reply that differs in one byte fails this, naming the call".) | With the hub up, no reply of the twin is a reply of the merge base's for a call the hub answers itself: `faults` holds "hub up, <world>: `<call>`: stderr differs at character n: …", naming the call, and the `expect(faults)` assertion fails |
| AC2 `#3421.7b68a484` | A hook that takes one of the six lines: for instance a decode that lets an unknown key through (the fourth key), one that drops the comparison of `ack` with the request's own ID, one whose `hold_until_ms` or `exit` bound is wider (-1, 256), one that reads a missing `stderr` as empty, or one that takes `v` 2. Any one of the six is enough; a twin per line proves each. (The criterion: "A hook that prints any of them fails this".) | The hook prints the marked bytes: `faults` holds "<the line>: the hook printed the hub's bytes […]", and the `expect(faults)` assertion fails |

Both were tried by hand on the base, without touching a source file, by changing the test's side in a scratch copy of
the test file that was then deleted: with two of AC2's six lines made valid (`hold_until_ms` 0, a `stderr` added) the
test failed at `expect(faults)` naming those two lines; and with this checkout's hook wrapped in a script that changes
one word of its stderr, AC1 failed at `expect(faults)` naming the calls.

## AC4: the two budgets (no test here)

"`deep-hook-overhead` and `hub-round-trip` stay within their budgets in `benchmarks/budgets.json`, read before and
after on one machine. A reading over either budget fails this."

Both tasks are in `benchmarks/budgets.json` on the base with `"margin": 0.5` and `"limits": {}`. So each one's budget
is the perf lane's comparison with the merge base: p50 and peak memory no more than 50% above the merge base's, over 20
alternated rounds a side (`scripts/benchmark.mjs`, `judgeTask` and `compare`; `scripts/perf.mjs` runs it for every
task; design, [Every task carries its own budgets]). That lane already is this criterion's check, task by task, with
both sides read on one machine. A vitest file here would run the same two benches through the same judge a second
time, and to do it honestly it would need a whole second checkout of the merge base, installed and built
(`hub-round-trip` runs the hub from `packages/*/dist`), and 42 runs of each bench: 1,000 hook calls and 1,000 hub
requests a run. The design also counts a timing only on a reference Mac on mains power; anywhere else it is a reading
and the check is INCONCLUSIVE. A test that passed on a busy machine's reading would prove nothing, so none is written.

AC4 is therefore proven by the perf lane's two results for the change (the issue's Proof: "the two budget readings"),
saved with the change's evidence, with the machine, its load and both sides' p50 and peak memory. No test carries
`#3421.ceafdcd9`, so the trace lane keeps AC4 open and a change that rests on this suite alone says `Part of #3421`
until the owner rules how AC4's readings close it.

## What the issue leaves open

- **What "#316's recorded calls" are** (above). No file under `tests/acceptance/316/` or elsewhere on the base records
  calls for #316.
- **Whether "byte for byte" covers stderr lines deep-hook writes about its own spool**, which name a new ID at each
  run. This suite compares them with the ID read as an ID.
- **The words a refused line leaves in the record.** The issue says only that it "reads as it does today: the hub is
  away". This suite holds that to the reply and to the spooled request carrying no `late` mark; it asserts nothing of
  what the hub later records.
- **The `ack` format.** The schema says `ack` is a ULID; the base's hand check only compares it with the request's ID.
  A line whose `ack` is the request's ID is always a ULID, so no test here tells the two apart.
- **AC4's close** (above).

## Files

- `helpers.ts`: temp homes, the three builds of deep-hook, the scratch checkout, the hook run as a hook entry, the
  stand-in hub, the spool read, and the planted exchange with its run-again rule.
- `recorded.test.ts` (AC1), `lines.test.ts` (AC2), `scratch.test.ts` (AC3).
- `lane.json`: the folder runs alone (#1327).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit: AC1 and AC2 passing, AC3 failing at its assertion.

[Hook protocol (deep-hook and the hub)]: ../../../docs/technical-design.md#hook-protocol-deep-hook-and-the-hub
[Every task carries its own budgets]: ../../../docs/technical-design.md
[The reference Macs]: ../../../docs/technical-design.md
