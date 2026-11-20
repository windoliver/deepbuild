# Acceptance tests for #2402: a hook handler that keeps missing its deadline is set aside

Three failures in a row stop the asking, the record says so, and a tool call stops paying for it.

Written first and blind, at base commit `89863843d85271d0aadcd9ca4702e411d67c7613` (origin/main, 2026-11-18), by a
job that saw no implementation of #2402, no other checkout, branch, pull request or stash. The implementing agent
does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Sources

- **The issue**, #2402, as given to this job: its text, Scope, five criteria and Proof. The issues it names (#6,
  #359) were not read; nothing here needed them.
- **The design**, `docs/technical-design.md`: Extension API (TypeScript, in-process) with "Several handlers, one
  reply" and "Context is typed"; Hook protocol (deep-hook and the hub); States people see; the Extensions and deep
  CLI rows of "One hub per user, a tiny hook client, and extensions in-process"; the done-gate row of First-party
  extensions (its floor, which holds in safe mode); One event log, with tables built from it; Numbers version 0 has
  to hold (the budget rule, the reference Macs); How we know version 0 works (Criteria to tests, Criteria in a
  checked shape, Wrong programs, Dogfooding, Tests written first, The edit guard).
- **`AGENTS.md`**.
- **The base, for surfaces only**: `packages/extension-host` (`host.ts`'s `hookRequest`, `HOOK_GRACE_MS`, `admit`,
  `check`, `load`, release entries; `runtime/deep.mjs`'s hook dispatch and late marker; `replies.ts`), `packages/hub`
  (`core.ts`'s `extensionHook`, `lateAnswered`, `appendReading` and where it opens the host with `release: []`;
  `server.ts`'s PreToolUse hold and role table; `wire.ts`; `plant.ts`; `doctor.ts`; `hub-control.ts`;
  `hook-replies.ts`; `log-reads.ts`; `stop-judging.ts`'s claim lane), `packages/gate/src/floor.ts`, the schemas
  `tool.before@2`, `task.created@1`, `doctor.item@1`, `extension.manifest@1`, `scripts/benchmark.mjs`,
  `scripts/perf.mjs`, `scripts/proof-change.mjs` (`criterionId`), `benchmarks/budgets.json`,
  `benchmarks/extension-host.mjs`.
- **Suites**, for their worlds and form. Imported unchanged: `tests/acceptance/29/h-d.ts` (a hub world: home, repo,
  handed definitions, Claude Code sessions through the real deep-hook, `events.read`, cleanup by PID) and
  `tests/acceptance/2118/helpers.ts` (stand-in agent CLIs, the "unheard" reading). Read in part, for form: #350's
  README, #881, #909, #1879's README, #2118, #23 `permissions/helpers.ts`, #29 (`floor.test.ts`, `budgets.test.ts`),
  #323's README and base failure, #348's `budgets.test.ts`.

## Run them

macOS, from the checkout's root, Node 24.22.0 and the pinned Rust toolchain first on PATH:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci
npm run build --workspaces                       # twice if the first fails on declaration order
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/2402 --no-file-parallelism --testTimeout=600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/2402/tsconfig.json
```

- The suite took 79 s on the base at a 1-minute load of 160 to 200 on 18 cores (BASE-FAILURE.txt). On a right
  program the story runs to its end; a throwaway one took 78 s for the story and the planted file at a load of 229
  to 295.
- `--no-file-parallelism`: the files start hubs and time tool calls, so nothing of this suite runs beside them.
- Each test's own timeout (30 min) covers the whole story, which runs inside the first test that asks for it.
- HOME is a temp folder for every child; folders are `/tmp/dh29-*` (#29's world), `/tmp/dh2402-bench-*` and
  `target/dh2402-base-*` (AC5's copy of the merge base's host, under the ignored target/), all removed at each
  file's end. Every process stopped is one this suite started, by PID. No network, no model, no agent binary (the
  hub's PATH gets #2118's stand-ins for `claude` and `codex`).
- A missing build, a hub that won't start, or a scene that didn't happen throws an Error starting `BLOCKED:`; a
  reading load spoiled is a skip whose message starts `INCONCLUSIVE`. Neither is a pass.

## The surface under test

What the tests touch, all of it a surface the issue, the design or the base names, except the names marked
*(chosen)*, which the issue leaves open and the implementer must match:

1. **`deep hub run`** on a temp home, with the base's test settings (`DEEP_HUB_TEST_CONFIRM`,
   `DEEP_HUB_TEST_DRAFTS`, `DEEP_HUB_TEST_WORK`, `DEEP_HUB_PLANT`) and two new ones below.
2. **deep-hook**, run as Claude Code runs our hook entry, a child of each session's own process (#29's world). A
   call is a Bash PreToolUse; its **wait** is deep-hook's run, from its start to its exit (`Ran.ms`), all a tool call
   waits for its PreToolUse. Its reply is read as Claude Code reads it.
3. **The record**, read with `events.read` on the cli role, as `deep` reads it.
4. **`deep doctor --json`**, in the hub's home, from a folder outside any repo, with no agent on PATH (#909's way):
   its doctor.item@1 objects `{ item, agent, code, level, evidence, fix }`.
5. **Packages installed under the hub's root before it starts**, through the extension host's public entry
   (`openExtensionHost`, `install`, `check`), as #2118's AC7 installs one; the hub loads them at its start.
6. **`DEEP_HUB_TEST_RELEASE=<file>`** *(chosen)*: a test-only seam. The file holds a JSON array of release entries
   in the host's own `ReleaseEntry` shape, `[{ "id", "version", "digest" }]`; the hub opens its extension host with
   them as `release` instead of `[]`, so an installed package they list, built by no agent, loads in the hub as part
   of DeepBuild's signed release. Only tests set it.
7. **`extension.restart`** *(chosen)*: a socket method on the cli role (the role table in `server.ts`), params
   `{ "id": "<extension id>" }`, which restarts that extension and answers without an error. "Restarting the
   extension" is read through it.
8. **`DEEP_HUB_PLANT=failures-never-cleared`** *(chosen)*: the planted wrong program AC2 names. The hub passes it on
   to its extension host, as it passes #1922's and #2650's: a host that counts a handler's failures and never clears
   the count (a reply in time leaves it as it was), everything else as fixed. It must be in `plant.ts`'s list, or
   the hub won't start with it.
9. **AC5 only**: the extension host's public entry (`openExtensionHost`, `install`, `check`, `load`, `hook`), the
   same entry of the merge base read from `git archive`, and `scripts/benchmark.mjs`'s `judgeLimit` and
   `fingerprint`.

### The packages

TypeScript packages from a folder, built by no agent, sealed with the host's own `packageDigest` (`helpers.ts`):

| Package | Its `tool.before` handler | Where it runs |
|---|---|---|
| `acme/hang` | never replies | the sandbox |
| `deepbuild/done-gate` | never replies; stands for the done gate's own handler | in the hub, listed in the release file |
| `acme/deny` | denies, in time, every command naming `./deploy.sh`, with its declared template | the sandbox |
| `acme/flaky` | never replies to a command naming `flaky-hang`; replies at once, adding nothing, to any other | the sandbox |

The three handlers that can fail keep **notes**: before anything else, each appends one `task.created` titled
`<id> asked <call> pid <pid>`, `<call>` being the call's `tool_use_id` from `tool.before`'s data and `<pid>` the
process it runs in. The notes say which calls a handler was asked about, and where it ran.

### The story

`set-aside.test.ts` tells one story through two hubs. Hub A holds all four packages; hub C, the control, is the same
world with `acme/deny` and `acme/flaky` only: "a host with no such extension".

1. Ten calls, `./deploy.sh step-<n>`: 1 to 5 in session S1, 6 to 10 in S2, each made on A and on C in turn, the
   order alternating. (AC1, AC4)
2. In session S3, `acme/flaky`'s scene: `flaky-hang-1`, `flaky-hang-2`, `in-time-3`, `flaky-hang-4`,
   `flaky-hang-5`, `in-time-6` (two failures, a reply in time, two failures, then a call it answers in time). (AC2)
3. `deep doctor --json`; the sessions' readings; `extension.restart { id: "acme/hang" }`; `deep doctor` again; one
   more call in S1. (AC3)
4. In session S4, "make the auth middleware reject expired tokens" opens a task whose handed definition locks; the
   agent reads and edits `src/auth.ts`, then stops saying "I ran `pnpm e2e` and it passed", a run it never made.
   (AC4)

`planted.test.ts` plays step 2 on a hub started with the plant and `acme/flaky` alone. `budget.test.ts` needs no hub.

## Criteria to tests

Each ID is `#2402.` and the first 8 hex digits of the SHA-256 of the criterion's checkbox text, trimmed, white space
collapsed (`scripts/proof-change.mjs`'s `criterionId`); each test's name starts with its `AC<n>` and ID.

| AC | ID | File | What it asserts | On the base |
|---|---|---|---|---|
| AC1 | `#2402.b0923c0d` | `set-aside.test.ts` | calls 1 to 3 each wait at least 500 ms; calls 4 to 10 each within 20 ms of the control's call of the same number; the record holds a failure of each of calls 1 to 3 and the set-aside | **fails**, naming the tenth call's wait (517 ms against 15 ms; the first 516 ms) and the empty record |
| AC2 | `#2402.e40df126` | `set-aside.test.ts` | `acme/flaky` is asked about each call of its scene and the one after | passes (nothing is ever set aside) |
| AC2 | `#2402.e40df126` | `planted.test.ts` | (wrong program) the same reading fails on the planted host, naming one call | BLOCKED: the base lists no such plant |
| AC3 | `#2402.afc86da6` | `set-aside.test.ts` | one doctor item naming `acme/hang`, `tool.before` and the last failure; one reading on S2 and on S3, at least one on S1, naming it; the restart taken; no item after it; the next call asked | BLOCKED: the handler is never set aside |
| AC4 | `#2402.43eeba91` | `set-aside.test.ts` | `acme/deny`'s deny on each of the ten calls | BLOCKED: as AC3 |
| AC4 | `#2402.43eeba91` | `set-aside.test.ts` | with `deepbuild/done-gate` in the hub and set aside, the claim citing `pnpm e2e` goes back naming it | BLOCKED: no release file is read, so the done gate runs sandboxed |
| AC5 | `#2402.bd6cb8d9` | `budget.test.ts` | the change's in-time `tool.before` against the merge base's, under 0.1 ms, in the hub and in the sandbox | INCONCLUSIVE: load above the cores, thermal state fair |

## How each criterion is read

- **AC1, the waits.** Each later call's wait is compared with the control's call of the same number, made just
  before or after it on hub C. A call from the fourth on fails when `acme/hang` was asked about it (its note) and it
  waited at least half the deadline (250 ms) more than the control's call: load can't produce that failure. The
  seven later calls also fail together when every one is over 20 ms by more than the margin (the larger of 5% and
  their spread, the design's timing rule). All within 20 ms passes; anything else is INCONCLUSIVE, as is a call
  deep-hook let through or spooled (the hub never decided it). The first three each wait at least the 500 ms
  deadline. Every failure leads with the tenth call's wait, the control's, and the first call's.
- **AC1, the record.** The issue leaves the kinds to the implementer, so none is named. The record "holds the
  failure" of call n when some event after the story's start, other than the hook's own (writer `hook`) and the
  handlers' notes, names `acme/hang`, `tool.before` and the call (its `tool_use_id`, or the ULID of its own
  `tool.before`), anywhere in its kind, subject or data. Each call's failure is the first such event; **the set-aside
  is any other event naming `acme/hang` and `tool.before`, or one whose kind or data says "aside"**. That last word is
  the issue's own and the one place a word is pinned. Read up to the restart.
- **AC2.** "Set nothing aside" is read by its effect: `acme/flaky`'s handler is asked about every call of the scene
  and about `in-time-6`, the call after the two more failures. A reply in time that the record shows failed spoils
  the scene: INCONCLUSIVE. On the planted host the first call it isn't asked about is named.
- **AC3.** The doctor item: exactly one item at a level other than `ok` whose text names `acme/hang`; it names
  `tool.before`, and the last failure, read as call 3's `tool_use_id` or `tool.before` ULID, or the word "deadline"
  (the failure was a missed deadline). Its code and level are the implementer's. The readings: `session.reading`
  events naming `acme/hang`, up to the restart. S2 and S3 made calls only after the set-aside, so each holds exactly
  one; S1, whose calls 4 and 5 came after it, holds at least one, since its own failures may be said there too.
  After `extension.restart` the doctor is read for up to 15 s and must show no item at a level other than `ok` naming
  `acme/hang`; the next call in S1 must be asked (its note).
- **AC4, the deny.** Each of the ten calls' replies is Claude Code's exit 2 with `[acme/deny]`. A missing deny on a
  call deep-hook let through, or one answered at the hub's 1,000 ms hold, is INCONCLUSIVE.
- **AC4, the done gate.** See the choice below. The claim's judgment is read as #323 and #29 read one through a real
  hub: the Stop's reply blocks (Claude Code's `decision: block`) and its words name the cited run, `pnpm e2e`. The
  claim must be on the record (`claim.made` on the task), or the test is BLOCKED.
- **AC1, AC3, AC4's scene.** AC3 and both AC4 tests stand on AC1's scene: `acme/hang` asked about calls 1 to 3 and
  about none of 4 to 10 (its notes). Without it they are BLOCKED, naming AC1, never judged.
- **AC5.** Four packages whose handler replies at once with nothing, loaded in the hub (release) and, separately,
  in the sandbox, on two hosts: the change's and the merge base's. 200 requests a side per run, alternating, after
  50 a side of warm-up; a run's reading is the change's median request time minus the merge base's, floored at 0
  (`judgeLimit` takes no negative reading). Five runs per place are judged by `judgeLimit` against 0.1 ms.

## Readings where the issue leaves a choice

- **"A host with no such extension"** is a second hub with the same world and the other two packages, not the same
  hub before an install: the control has to run at the same moment, under the same load.
- **"The done gate's own handler."** In the design the done gate is a first-party extension inside DeepBuild's
  signed release, loaded in the hub, with its floor in the core whatever gate is installed. At the base the hub loads
  no release package (`release: []`), the gate is core code, and the installer refuses a package that replaces
  `done-gate` or provides `gate@1`. So the base has no surface that makes a done gate handler. The smallest one is the
  release file (`DEEP_HUB_TEST_RELEASE`, *chosen*), which lets a test package, `deepbuild/done-gate`, load in the hub as
  the release's own. Its notes must show it ran in the hub's process, or the test is BLOCKED. "As in safe mode" is
  read as the floor's send-back, the same one safe mode keeps; no `--safe` hub is run.
- **"Restarting the extension"** is `extension.restart` *(chosen)*: the host has `disable` and `load` and the hub's
  socket has `extension.install`, but nothing restarts one extension.
- **"Its next call is asked again"** is read from the handler's own note, not from a wait.
- **"Recorded as failed"** (calls 1 to 3) is the record's, as "The record holds the three failures" says; the joined
  reply's `failed` list isn't on any surface the hub shows.
- **AC2's "fourth failure".** A host whose count is never cleared reaches three at `flaky-hang-4`, so `flaky-hang-5`,
  the fourth failure, is the first call not asked; one that set aside on a count of four would first skip
  `in-time-6`. The planted test accepts the failure naming either, provided it names exactly one call. The
  throwaway planted host named `flaky-hang-5`.
- **AC5's "a tool.before whose handlers all reply in time"** is four handlers replying `null` at once, timed in the
  extension host. The hub's own share (a deep-hook call's noise is many times 0.1 ms) isn't timed.
- **AC5's "compared with the merge base"**: no perf task can compare a new task with a base that lacks it, so the test
  runs both sides itself, the merge base's `packages/extension-host` and root `tsconfig.json` read with
  `git archive $(git merge-base HEAD origin/main)`. Both sides resolve the same workspace packages (the checkout's),
  so a change outside the host's own package that slows the hook isn't seen.

## What isn't encoded

- The fresh try that an update, turning an extension on again, or a hub start gives; only the restart is read.
- A throw as a failure: every failing handler here misses its deadline.
- What the set-aside handler's later calls do once its fresh try fails again.
- The joined reply's `failed` entries, and the hub's stderr line.
- The Scope's "the host stops asking it" is read only through the notes, as the scene the later criteria stand on.
- AC3 and AC4 name no wrong program; on the base both are BLOCKED (the scene never happens), so their proof against a
  wrong program is the mutation lane's.
- AC5 has no wrong program either; the base compared with itself reads near 0.
- Linux, and any real agent.

## What the implementer adds outside this folder

1. `DEEP_HUB_PLANT=failures-never-cleared` in `packages/hub/src/plant.ts` (the type and the list), passed on to the
   extension host where `core.ts` opens it, and the host's planted program that never clears a handler's count.
2. `DEEP_HUB_TEST_RELEASE=<file>`, read where `core.ts` opens the extension host: the file's JSON array of
   `{ id, version, digest }` becomes `release`.
3. The socket method `extension.restart { id }` on the cli role.
4. A doctor item for each set-aside handler, at a level other than `ok`, naming the extension, `tool.before` and the
   last failure, with a code from `doctor.item@1`'s list (a new code there is the implementer's).
5. One `session.reading` naming the extension on each session whose calls a set-aside handler would have judged.
6. The event kinds that record a failure (naming the extension, `tool.before` and the call by its `tool_use_id` or its
   `tool.before`'s ULID) and the set-aside, in the catalogue.
7. Whether `tests/acceptance/2402/` goes on `scripts/lanes.mjs`'s one-at-a-time list (`alone`); its files start hubs
   and time calls. This job changed no lane list.

## Checked apart from the suite

A throwaway right program, written outside this folder, run once and removed (the five files restored with
`git checkout`, the packages rebuilt): the host skipping a handler after three failures in a row and clearing the
count on a reply in time (not clearing it under the plant), the release file, `extension.restart`, and the plant in
the hub's list. It recorded nothing and added no doctor item or reading. Against it, at a load of 229 to 295:

- AC1's waits passed: calls 4 to 10 came 9 ms faster to 3 ms slower than the control's; AC1 then failed only on the
  record, as it should against a program that records nothing.
- AC2 passed; the planted test passed, the planted host failing the scene naming `flaky-hang-5`.
- AC3 failed at the doctor's item, as it should; its later steps weren't reached.
- Both AC4 tests passed: the deny stood on all ten calls, and `deepbuild/done-gate` ran in the hub, was set aside
  after call 3, and the claim went back naming `pnpm e2e`.
- AC5 read INCONCLUSIVE (load), with gains of 0.0002 to 0.0004 ms in the hub and up to 0.03 ms in the sandbox.

## Files

- `helpers.ts`: the packages, their install, the hub with this issue's settings, calls and their waits, the notes,
  the record's readings, `deep doctor`, the restart, and the judges for AC1's waits and AC2's scene.
- `set-aside.test.ts`: the story, and AC1, AC2, AC3 and AC4's two tests.
- `planted.test.ts`: AC2's wrong program.
- `budget.test.ts`: AC5.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base.
