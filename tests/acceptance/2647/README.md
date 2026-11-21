# Acceptance tests for #2647: a stop's verdict reads compile once and spawn once

Written blind from issue #2647 (its Scope, its 5 checkbox criteria and its Proof), `docs/technical-design.md` (An agent
says it's done; Numbers version 0 has to hold; How runs become one of five verdicts, Whose checks count; How we know
version 0 works: Wrong programs, Criteria in a checked shape, Dogfooding), `AGENTS.md`, and base commit `6a2b68d44`
(origin/main). The job that wrote them never saw an implementation of #2647. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The base code was read for its surfaces only: `packages/gate/src/own.ts` (`ownChanges`, through `@deepbuild/gate`'s
entry), `packages/hub/src/gate-runner.ts` (`changesOf`, `ownChanged`, `verdictOf`), `packages/asks/src/index.ts`
(`needsYou`, `cardOf`, the private `changed` and its `execFile` git), and `packages/hub/src/codex-settings.ts`
(`recordEntries`, `withEntries`, `recordedHome`, `recorded`, `entriesFor`, `modified`) with `claude-settings.ts`'s
`readJson`. Sibling suites, for conventions and helpers: `tests/acceptance/2118` (its gate-runner bench, which
`gate.ts` follows), `tests/acceptance/31` (whose `helpers.ts` gives the world, repos and temp folders), `tests/acceptance/880`
(the asks core seeded on its record, which `asks.ts` follows), `tests/acceptance/plans.ts` and `24/helpers.ts`, and
`tests/acceptance/2652`, `1114`, `1156` (README, twins and tsconfig shape).

| AC | Tag | Criterion, in short | Test |
| --- | --- | --- | --- |
| AC1 | `#2647.c40dfa9f` | a claim that changed 300 files under 20 runner configs: a stop's verdict reads compile each pattern once, by a preload wrapping `RegExp`; on the merge base the count rises with every read | `ac1-verdict-patterns.test.ts` |
| AC2 | `#2647.7c79c9b7` | `ownChanges` returns the merge base's list for the gate's cases and 10,000 generated claims; a version that keeps one claim's answer for the next fails, naming the file | `ac2-own-changes-same.test.ts` |
| AC3 | `#2647.c2acca3a` | a Needs you load of five asks of one session pinned to one moved commit starts three `git` processes (a stand-in on PATH counts) and shows the merge base's cards; fifteen on the merge base | `ac3-needs-you-git.test.ts` |
| AC4 | `#2647.e5082fa7` | two asks pinned to different commits of one worktree each get their own diff; a load that reuses the first diff fails, naming the ask | `ac4-own-diff.test.ts` |
| AC5 | `#2647.799c3768` | one `modified` call opens `codex-hooks.json` and `hooks.json` once each, and returns the merge base's list for an untouched file, an edited entry and a removed entry | `ac5-codex-reads.test.ts` |

Tags are derived as `scripts/proof-change.mjs` derives them: `#2647.` and the first 8 hex of the SHA-256 of the
criterion's text after `- [ ] `, trimmed, white space collapsed (checked against the issue's body). Each test file
binds its own tag in a constant; each `describe` and `it` carries it.

## How to run

Node 24.22 (`.node-version`) first on `PATH`, with the repo's `node_modules` installed (`npm ci` once):

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/2647
node node_modules/typescript/bin/tsc -p tests/acceptance/2647/tsconfig.json
```

- No build is needed: every test imports the packages' sources, as #2118's and #880's suites do.
- Folders are under `/tmp/dh2647-*` (AC3 to AC5) and `/tmp/dh31-*` (AC1, #31's world), each removed after its file.
  HOME is #31's temp folder for AC1; AC3 and AC4's git runs in the test's own folder; AC5 sets `CODEX_HOME` for the
  test and puts it back. No network, no model, no hub process, no `claude` or `codex` binary. The only processes
  started are git (through the stand-in's `/bin/sh` in AC3) and AC1's check, a node script run to its end.
- The whole folder took under 2 s on the base (on a Mac at a load near 13).

## The readings

### AC1: patterns compiled over a stop's verdict reads

- **The surface.** The hub's own `GateRunner` on #2118's bench (`gate.ts`): real git, the real base-commit service and
  record, and the hub's run service stood in for at `start` and `ended` (the check's program runs in the checkout the
  gate names, and its run is recorded and keyed as `runs.ts` does). The gate runner works out the claim's changes from
  its worktree itself (`changesOf`), as in the hub.
- **The claim.** The merge base holds 20 packages, `pkg00` to `pkg19`, each with a `vitest.config.ts` that names a setup
  file of its own; the session's worktree adds 15 files under each package's `src/`, 300 in all, each named
  `nNNxKK.ts` so no name is part of another. `pkg00`'s config also names `./src/n00x00.ts`, so the claim's check
  counts as the agent's own, naming that file: the patterns are really read (else `BLOCKED`). The check passes.
- **The count.** `regexp-count.ts` is the preload: imported first, before any module under test, it replaces the
  global `RegExp` with a wrapper that hands each construction's source to a counter and builds it with the real
  constructor. A construction is one of the claim's own-change patterns when its source holds one of the 300 file
  names: every pattern that asks whether a config names a changed file holds that file's name, wherever a change
  moves the code that builds it.
- **What must hold.** Over the stop and ten `verdictOf` reads (a stop reads it five to ten times), no such pattern is
  compiled more than once, and the reads after the first compile none. Every read gives the same verdict.
- **On the base** each read compiles 599 (two per changed file but the one named, whose first pattern matches):
  "compiled 5990 times over its stop and 10 verdict reads (0 at the stop, then 599, 599, ... at each read), for 599
  distinct patterns: 599 of them more than once, and 5391 compilations in the reads after the first".

### AC2: `ownChanges`, the merge base's list

- **The reference.** `reference-own.ts` is the merge base's `ownChanges` (with `ownRead` and the runner-config
  pattern), copied as it was at `6a2b68d44`.
- **The cases.** `packages/gate`'s own tests (`packages/gate/test/*.test.ts` at the base) hold no case of `ownChanges`:
  none calls it, and no other package test does (Open points 2). In their place, one claim per rule own.ts's comments
  give (a read file under a test, fixture, snapshot, script or spec folder; code under test never; a runner config
  anywhere; a file a config names, with or without its extension and `./`; only under the config's own folder;
  regular-expression characters taken as written; a name out of quotes not named; package.json by its scripts and the
  run's read; both planted modes; one path under other configs in the next claim; an empty claim).
- **The generated claims.** 10,000 claims from fast-check, seed 2647: up to 14 changed paths from 128 (8 folders × 16
  names, among them config files, conftest.py, package.json and names with `+`, `(`, `$`, `.`), up to 5 configs in 4
  folders whose text names, half the time, a changed file relative to the config's folder (quote kinds, `./` or not,
  extension or not, near misses that close with `x`), a scripts flag, a plant now and then, and three read lists.
  The generator must reach the named-file rule in at least 2,000 claims, else `BLOCKED`.
- **What must hold.** Every claim is a new `changes` object, as the gate runner makes one per claim, asked three times
  with different read lists, one claim after another in one process. Each of the 30,000 lists (and each rule case's)
  must equal the merge base's, in order. A difference names the file first, then the claim and both lists.
- **On the base** both tests pass (the program is the merge base). The criterion's failure is the planted version's.

### AC3: git processes in one Needs you load

- **The surface.** The real asks core (`openAsks`, `@deepbuild/asks`'s entry) on the real record, as #880's suite seeds
  it: one Claude Code session started in a real worktree, and authority asks raised through the core's own `raise`,
  each pinned to a commit (`asks.ts`).
- **The count.** A script named `git`, first on the PATH of this process (the one the asks core runs in) while the
  load runs, appends one line per start to a log and execs the real git with the same arguments. The core starts git
  through node's `execFile`, which looks `git` up on the process's PATH as it starts it.
- **The load.** Five asks, each pinned to C1; the worktree then commits C2. One `needsYou` call.
- **What must hold.** The five asks are among the cards, each showing as `changed` exactly what the merge base reads
  for C1 to the head: `{ from: C1, to: C2, files: git diff --name-only, diff: git diff }`, read with git in this
  process's own environment; and the load started three git processes.
- **On the base**: "started 15 git processes ...: git rev-parse HEAD ×5, git diff --name-only ×5, git diff ×5".

### AC4: each ask its own diff

- Same bench. The worktree commits C1, C2 and C3; ask A is pinned to C1, ask B to C2, the head is C3 (A's diff names
  three files, B's one; else `BLOCKED`). One `needsYou` load must show each card the diff from its own commit to the
  head, as AC3's reading has it; a card that doesn't is named by its ask handle, its pin and the diff it shows.
- **On the base** it passes. **The planted load** (`reuses-first-diff`) fails naming B: "ask:..., pinned to a5132aa72285,
  shows the diff from 20d7a6be55f2 over [README.md, src/cart.ts, src/tax.ts], where its own is from a5132aa72285 over
  [src/cart.ts]".

### AC5: opens in one `modified` call

- **The files.** A hub root and a Codex home: `recordEntries` writes `<root>/codex-hooks.json` (setup's twelve
  entries and the home), `withEntries('')` gives `hooks.json` DeepBuild's twelve entries, then one case edits it. The
  process's `CODEX_HOME` then names another folder, so `modified` must read the home setup recorded.
- **The count** (`opens.ts`). While one `modified` call runs, node:fs's opening reads by path (`readFileSync`,
  `openSync`, `readFile`, `open`, `createReadStream`, and `fs/promises`' `readFile` and `open`) are wrapped, and
  `syncBuiltinESMExports` carries the wrappers to every module's named imports of node:fs; each open of either file
  counts. `existsSync` is no open.
- **What must hold.** For each case, the list equals the merge base's (`reference-modified.ts`, its copy of `modified`
  and the helpers it calls), and `codex-hooks.json` and `hooks.json` were opened once each.
- **On the base**: "opened codex-hooks.json 14 times and hooks.json 12 times" in all three cases (one `recordedHome`
  and one `recorded`, then a `recordedHome` and a `hooks.json` read per entry).

## Planted programs

Each is a whole replacement of one base source file, laid over the change by the before lane
(`twins/<name>/<repo path>`, `twins.json`). Both type-check as their package (`strict`, `noUnusedLocals`).

| Twin | AC | File | What the planted version does |
| --- | --- | --- | --- |
| `keeps-answer-across-claims` | AC2 | `packages/gate/src/own.ts` | Keeps whether a config names a path in a module-level map keyed by the path alone, so the first claim's answer is kept for every later claim with that path, whatever its configs. On the base's copy both AC2 tests fail: the rule case "the same path under other configs in the next claim (2 of 2)" with "file web/setup.ts", and 13,714 of the 30,000 generated reads. |
| `reuses-first-diff` | AC4 | `packages/asks/src/index.ts` | Within one `needsYou` load, keeps what changed by the session's worktree alone: the first card's read is reused for every later card of that worktree. It starts three git processes for AC3's load (one worktree, one commit), so AC3 passes on it; AC4 fails, naming B. |

## Open points: readings this suite chose

1. **AC1's "each pattern once".** The issue says the part of `ownChanges` that depends only on a claim's changes is
   worked out once per claim. The test allows each pattern to be compiled once, at the stop or at any read, and
   requires none in the reads after the first; a change that compiles none at all also holds. A change that builds
   one pattern per config holding many file names counts each such pattern once.
2. **AC2's "every case of `packages/gate`'s own tests".** At the base no test in `packages/gate/test/` (nor any other
   package's tests or an acceptance suite) calls `ownChanges`, so there is no such case to replay. The rule cases
   stand for them; if the implementer adds `ownChanges` cases to `packages/gate/test/`, they are not replayed here.
3. **AC3's "the cards the merge base shows"** is read as the same five asks, each with the `changed` the merge base
   reads. The other fields of a card don't come from git and the issue doesn't touch them.
4. **AC3's count is exactly three**, as the criterion says: one `rev-parse HEAD`, one `diff --name-only` and one whole
   `diff` for the one worktree and commit.
5. **Twins over a changed file.** Each twin is the base's file with the planted mistake. Laid over the change it also
   takes the change's own edits to that file out; if the change adds an export to `own.ts` or `index.ts` that another
   file then imports, the twin no longer builds and the before lane reads it as unrunnable. The implementer keeps
   the files' exports as they are, or a dispute goes to a redraft.
6. **AC5 runs in the test's own process**, through the module's real file reads, not a child: the wrappers are taken
   out when the call returns, and only the two named files are counted.

`BASE-FAILURE.txt` is left to the implementing session, which runs this suite on the base and saves it.
