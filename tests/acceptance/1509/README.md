# Acceptance tests for #1509: a package run straight from a registry is a dependency decision, and the ask says how new it is

Written first and blind, before any implementation, from issue #1509 (its text as of November 18, 2026: the
description, Scope, its six acceptance criteria, Proof and Depends on), `AGENTS.md` and `docs/technical-design.md`
(Before each command: "Adding a dependency … that the plan doesn't name is a decision" and "Adding a dependency also
covers running one straight from a registry …"; An ask, and your answer getting back; Hooks are evidence, not a state
machine; the view row of First-party extensions that ship on by default, the return card; How we know version 0 works,
Dogfooding). The base is `c26bdb5be` (origin/main, "Merge pull request #2786"), with no implementation of #1509. At the
base I read, for their surfaces only: `crates/deep-hook/src/matcher.rs` (`adds_dependency`, the `effect:` classes),
`crates/deep-hook/src/main.rs` (`check`, the watchdog, the spool) and `crates/deep-hook/default-rules.json`
(`record-new-dependency`); `packages/hub/src/server.ts` (`gated`, `DECIDED_MATCH`, `GATE_HOLD_MS`, the `DEEP_HUB_TEST_*`
settings), `core.ts` (`toolGate`, the stop rule's claim), `standing.ts` (`aboutCall`), `holds.ts` (`decide`),
`ask-tasks.ts` (`Plan`, `asksForChange`, `claimEarly`), `hookmap.ts` (`tool.before`'s `matched` and `late`),
`spool.ts`, `sentences.ts`, `hub-readings.ts` (`changes.read`) and `plant.ts`; `scripts/proof-change.mjs`
(`criterionId`) and `scripts/proof-runs.mjs` (twins, failing at an assertion); and the suites of #23 (`permissions/`,
whose helpers these adapt), #317, #316, #321, #1999 and #1514. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## How to run

```sh
npm ci                                   # once
npm run build --workspaces               # the hub and the deep CLI the tests start
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook   # target/debug/deep-hook, which every hook runs
node node_modules/vitest/vitest.mjs run tests/acceptance/1509/ --no-file-parallelism --testTimeout=600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/1509/tsconfig.json
```

- **Runs alone.** Each hub test starts a hub of its own, so the folder belongs on `scripts/lanes.mjs`'s `alone` list
  (below). The implementer adds it; this job edits nothing outside this folder.
- **Folders and processes.** Every world is a fresh `/tmp/dh1509-*` (a Unix socket path must fit in 104 bytes), `HOME`
  is `<tmp>/h` for every process, and nothing touches the real `~/.deepbuild` or `~/.claude`. Processes are stopped by
  PID only (`helpers.ts`, `cleanup`); the fixture registry is a server in the test's own process, closed by the test.
- **No network, no model, no package manager.** The registry is the test's server on 127.0.0.1. Every child's `PATH`
  is `<tmp>/bin` first, where `claude` and `codex` are `fixtures/stub-bin.sh` (it logs the call and fails), then Node's
  folder and the system folders, so no real agent CLI is reachable. No child inherits a proxy, a credential, npm's
  configuration or this process's `DEEP_*`, `GIT_*`, `CLAUDE*` or `CODEX*` variables. deep-hook decides each call and
  nothing executes it: no `npx`, `npm` or `pip` ever runs.
- **Time.** On the base the folder took 72 to 76 s: AC6 about 37 s (it reads its claim's change for 30 s before
  failing), AC3 11 s, AC2 8 s, AC1's and AC4's hub tests 5 s each, AC5 4 s, AC1's check-mode test under 1 s. A correct
  program goes further in each test: a held call's ask is found within 30 s, each call that runs is watched 3 s for an
  ask, and AC6 goes on to a second session.

## The surface under test

Names the issue, the design or a merged suite gives are used as they are. Each name this job chose is marked
*(chosen)*.

- **deep-hook**, run as Claude Code runs our hook entry: `deep-hook claude-code <event>`, the payload on stdin, as a
  child of that session's own Claude Code process (`fixtures/agent.mjs`, from #321 by way of #23). Payloads and
  transcripts are shaped like the corpus's (`adapters/corpus/claude-code`), every transcript entry at the newest
  version Claude Code's facts cover. A call's PreToolUse reply is read as #23's suite reads it: denied (exit 2 or a
  deny), allowed, or passed on to the permission mode.
- **deep-hook's check mode** (`deep-hook check`: `{"entry", "call"}` on stdin, `{"matched": …}` out), with every
  shipped default entry whose `match` is `effect:dependency`, for the Scope's other spellings (AC1's second test).
- **`deep hub run`** with `DEEP_HUB_PLANT` and `DEEP_HUB_TEST_STOP_HOLD_MS` (the hub's own setting that shortens a
  stop's hold; AC6 only, 3 s), and:
- **`DEEP_HUB_TEST_REGISTRY`** *(chosen)*: the base URL of the package registry the hub reads, in place of npm's
  public one, set only by tests, as `DEEP_HUB_TEST_FORGE` names the forge's API base. Every hub these tests start has
  it: the fixture registry's URL, or, in AC4's second leg, that URL once nothing listens there. When it is set the hub
  reads every registry there and nowhere else, so a test never reaches the network.
- **The fixture registry's documents** *(chosen: npm's registry's own shape)*: `GET <base>/<name>` answers the
  package's document as npm's registry serves it, `{"_id", "name", "dist-tags": {"latest"}, "versions": {<version>:
  {"name", "version", "dist"}}, "time": {"created", "modified", <version>: <ISO 8601 time>}}`, where `time.created`
  is when the name was first published and `time[<version>]` when that version was. `GET <base>/<name>/<version or
  dist-tag>` answers that version's own document (no times), and anything else is 404. No credential is needed or
  checked.
- **The socket**, as the cli role with the control token: `events.read` (`ask.created` with its question and kind,
  the closing events, `tool.before` with the entries deep-hook `matched` and `late`, `claim.made`) and `changes.read`.
- **The return card's what-changed line** *(chosen surface)*: `changes.read`'s `change.sentence`, for the claim the
  session's turn made. The return card (#367) isn't built at the base; #1999 made `change.sentence`, filled from the
  record by `changeSentence`, "the same sentence the return card leads with", and `packages/hub/src/sentences.ts` says
  so: "The return card (#367) leads with the change's". So "shows on the return card's what-changed line" is read as
  that sentence naming the package's version. The claim is the stop rule's (#303), with no `deep_claim` and no
  `deep mcp`: the prompt you type asks for a change, so it opens a task, and the turn's stop is a claim on it.
- **Files** under `HOME`: `~/.deepbuild/rules.json` (the shipped default guards, verbatim), `~/.deepbuild/config.json`
  (your ask settings: #321's, authority deadline 1 day, no batch), and the spool, read only to tell a late hook.
- **Planted programs**, selected with `DEEP_HUB_PLANT` through `packages/hub/src/plant.ts` (`Plant` and `PLANTS`); the
  implementer adds each name (below).

### The world

`helpers.ts`, `makeWorld`. A fresh home with the shipped default guards as `rules.json` and your ask settings. A git
repository with one commit on `main`, the base, where every session works:

- `package.json`: `shop` 1.0.0, with `vitest` 3.2.4 as its one dev dependency;
- `package-lock.json`, npm's v3 format: `vitest` at 3.2.4 and nothing else, so it holds neither `some-pkg`, `other-pkg`
  nor `left-pad`;
- `requirements.txt`: `some-lib==1.0.0`;
- `src/signup.ts`.

No session's plan names anything: the sessions of AC1 to AC5 and AC6's second one work on no task, and AC6's first
works on the task its typed prompt opened, which has no handed definition and so no plan (`ask-tasks.ts`, `Plan`).

### The fixture registry

`helpers.ts`, `fixturePackages` and `startRegistry`, dated from the moment the world is built:

| Package | Name first published | Versions, published | `latest` | Read in |
|---|---|---|---|---|
| `some-pkg` | 4 years and 60 days ago | 1.0.0, 3 years and 30 days ago; 2.0.0, 2 days ago | 2.0.0 | AC1, AC4, AC5, AC6 |
| `other-pkg` | 6 years ago | 1.2.0, 3 years and 30 days ago | 1.2.0 | AC4, with the registry down |
| `left-pad` | 2 days ago | 1.3.0, 2 days ago | 1.3.0 | AC3 |
| `vitest` | 5 years ago | 3.2.4 (the lockfile's), 150 days ago; 4.0.0, 2 days ago | 4.0.0 | AC2 |

Each call a criterion expects held is held under every reading the Scope allows (a new version, a new name, or
couldn't check), so AC1's and AC3's holds don't turn on whether the age rule covers installs. Each call expected to
run would be held by a program that ignores what it must read: vitest's `latest` is new, and other-pkg would read as
old if the registry answered.

### Playing Claude Code

The test fires each hook as Claude Code would: SessionStart, a prompt you type (AC6), each call's PreToolUse and, when
the call isn't denied, its result and PostToolUse; an agent's Write (AC3) is written to disk as the tool writes it;
the turn's Stop carries the agent's last words (AC6). Claude Code's own permission prompt, which its mode may show for a
call DeepBuild lets through, is Claude Code's, not an ask, and isn't played.

### Late hooks

deep-hook gives the hub 20 ms to acknowledge a hook and decides alone at 48 ms (`ACK_BUDGET`, `WATCHDOG` in
`crates/deep-hook/src/main.rs`): it spools the call and, unless a `fail_closed` entry matched, lets it through. On a
loaded Mac the hub then never decided it.
A reading is INCONCLUSIVE (a skip that names the load average, never a pass) when deep-hook says it spooled the call or
denied it on the floor "while the hub doesn't answer", when a spool file still holds the call (deep-hook spools a call
only when it decides alone; read before the session's next hook, whose arrival replays the spool), when the record
marks the call late, or when the hub's gate says it couldn't check the call "in time" (its hold, `GATE_HOLD_MS`, 10 s,
ran out). Unlike #23's suite, a hook that ended quietly past 45 ms isn't read as late, since a call the gate lets run
ends that way too.

## Readings where the issue leaves a choice

1. **"Held with an ask naming the package"**: its PreToolUse is denied, an authority ask whose question names the
   package is open, and what the agent reads names that ask's handle, as #23's suite reads "asked".
2. **"Runs with no ask"**: its PreToolUse isn't denied (a pass or an allow), and 3 s after it ran no ask raised since
   names the call or its package.
3. **"A session whose plan doesn't name it"**: a session with no plan (The world).
4. **"At the lockfile's version"** (AC2): `npx vitest` names no version, so npx runs the lockfile's 3.2.4. Its
   contrast, `npx vitest@4.0.0`, a version the lockfile doesn't hold, published 2 days ago, is held: the Scope exempts
   a package "already in the repo's lockfile at that version". Without the contrast, the base, which reads no npx at
   all, would pass AC2; with it, AC2 fails on the base and on a program that exempts a package whatever version is
   named, as well as on one that ignores the lockfile.
5. **"Since the base"** (AC3): the repo's one commit on `main`. The agent's Write is never committed, so the name it
   adds is added since HEAD, since the merge base with `main` and since the session's start alike. "With no manifest
   change" is `package.json` and `requirements.txt` as committed. The three no-change calls run first, so on the base
   the test fails at the pip call, as the criterion says.
6. **"Shows that in the question"** (AC4): the question shows the version's age in days ("2 days", "two days", or 48
   hours) or its publish date (ISO, in UTC or local time, or the month by name with the day), and names it as new (the
   word "new" or "newly"): the Scope says "A version under 7 days old (drafted) is named as new", the design "names a
   version under a week old as new". When the name was first published isn't asserted.
7. **"It never says old or safe"**: neither word, nor older, oldest, safer, safest or safely, appears whole in either
   question. So "2 days old" fails, and "published 2 days ago" doesn't.
8. **"The registry down"**: nothing listens at its address (the server closed, every connection dropped), so each
   read is refused. The call then asks about `other-pkg` 1.2.0, a package the hub hasn't read, which would read three
   years old if the registry answered, so a program that reads "couldn't check" as old lets it run and fails.
   **"Couldn't check"** is those words, with a straight or curly apostrophe, in any case.
9. **"Allowed and recorded, as a dependency is today"** (AC5): with no hub at `~/.deepbuild/hub.sock`, deep-hook alone
   allows the call, and once the hub starts and replays the spool, the call's `tool.before` names an entry whose match
   is `effect:dependency` among the entries deep-hook matched, as `npm install left-pad@1.3.0`'s does today (checked
   first, in the same world: hookmap.ts, "a watched match is recorded"). At the base the npx call is recorded matched
   to nothing, so the test fails on the base, naming the call.
10. **"The return card names it"** (AC6): its what-changed line names `some-pkg` and `1.0.0` ("it" is a version). The
    age the Scope also puts on that line isn't asserted, since the criterion says "names it".
11. **"Three years ago"** is three years and 30 days, and the name four years and 60 days, so any way of counting
    years reads three and four, and the version is far past the drafted 7 days. "2 days ago" is exactly 48 hours
    before the world is built; the hub reads it within minutes.
12. **"A planted guard that asks"** is a hub that asks for every package run straight from a registry, whatever the
    registry says of it; "fails, naming the ask" is AC6's scenario failing with that ask's handle, `ask:<id>`.
13. **The Scope's other spellings** (`bunx`, `pnpm dlx`, `yarn dlx`, `uvx`, `pipx run`, `pipx install`, `python -m pip
    install`, `uv tool run`, and the description's `python3 -m pip install`) are checked only through deep-hook's check
    mode, in the fixture repo, whose lockfile holds none of them: each must be read as the dependency effect, as must
    `npx -y some-pkg@latest`. Nothing asserts how check mode reads a package the lockfile holds, since the lockfile may
    be the hub's to read.

## Criteria to tests

Each ID is `scripts/proof-change.mjs`'s `criterionId`: `#1509.` and the first 8 hex digits of the SHA-256 of the
criterion's text, trimmed, white space collapsed, computed from the live issue. Each test's name starts with its
`AC<n> #1509.<h8>`.

| Criterion | File | Test | Wrong programs it fails on | On the base |
|---|---|---|---|---|
| AC1 `#1509.a4073779` `npx -y some-pkg@latest`, not in the lockfile, no plan naming it: held with an ask naming the package | `npx.test.ts` | the call is held with an authority ask naming some-pkg; and deep-hook check reads it and the Scope's other spellings as the dependency effect | the base (runs it; reads no spelling); a program that reads npx but not the others | fails naming the call |
| AC2 `#1509.ae8eec29` `npx vitest` at the lockfile's version runs with no ask | `lockfile.test.ts` | `npx vitest` runs with no ask; its contrast `npx vitest@4.0.0` is held | a program that ignores the lockfile (holds `npx vitest`, vitest's latest being 2 days old); one that exempts any version; the base (no contrast held) | fails at the contrast |
| AC3 `#1509.a066c839` a bare install read through the diff | `manifest.test.ts` | `npm install`, `npm ci`, `pip install -r requirements.txt` run with no ask; after the agent's Write adds left-pad, `npm install` is held naming left-pad | the base (reads requirements.txt as a package); a program that holds a bare install, or never reads the diff | fails naming the pip call |
| AC4 `#1509.69494a39` the question shows a 2-day-old version; registry down, "couldn't check"; never old or safe | `registry.test.ts` | the ask for `npx -y some-pkg@latest` shows 2 days (or the date) and new; with the registry down the ask for `npx -y other-pkg@1.2.0` says "couldn't check"; neither says old or safe | a question with no reading; one that says old or safe; a program that reads couldn't check as old (runs other-pkg) | fails: the call isn't held |
| AC5 `#1509.6384e10e` hub stopped: allowed and recorded, as a dependency is today | `hub-down.test.ts` | with no hub, `npm install left-pad@1.3.0` and `npx -y some-pkg@latest` are allowed; with the hub back, both are recorded matched to the dependency entry | the base (npx recorded as no dependency); a deep-hook that denies it with the hub down | fails naming the call |
| AC6 `#1509.231f163d` three years old: runs, no ask, the return card names it; a planted guard that asks fails; 2 days old: held | `old-version.test.ts` | `npx -y some-pkg@1.0.0` runs with no ask and its turn's change sentence names some-pkg 1.0.0; `npx -y some-pkg@2.0.0` is held; and the wrong-program test | plant `asks-every-registry-run` (names the ask); the base (the line doesn't name it) | fails at the line; the wrong-program test is BLOCKED |

## Wrong programs the implementer adds

| Name | Criterion | What it does wrong | How its test fails |
|---|---|---|---|
| `asks-every-registry-run` *(chosen)* | AC6 | a guard that asks for every package run straight from a registry, whatever the registry says of it: the three-year-old `some-pkg` 1.0.0 is held with an ask | `AC6 … \`npx -y some-pkg@1.0.0\` must run with no ask: it was held by ask:<id> asking …`, which the wrong-program test matches |

It goes in `packages/hub/src/plant.ts` (`Plant` and `PLANTS`), read where the hub decides a package run from a
registry. `twins.json` names, for AC6, `always-asks-every-registry-run` (the implementer's `plant.ts` with the plant
always on, so AC6's own test fails) and `plants-ignored` (with every plant off, so the wrong-program test fails), as
#1514's and #19's twins do. The implementer builds those folders under `twins/` on its own `plant.ts`, since a copy of
the base's would go stale.

No other plant: each other criterion's test fails on the base at an assertion in this folder, and the wrong programs
its row names are ruled out by its own legs (AC2's contrast, AC4's down leg, AC5's control), with no plant needed.

## BLOCKED and INCONCLUSIVE legs

- **INCONCLUSIVE** (a skip, never a pass): any hub leg on a loaded Mac, when a hook was late or the gate's hold ran out
  (Late hooks). #23's suite read about a quarter of its hub tests INCONCLUSIVE at load averages above 70; these legs
  are as exposed.
- **BLOCKED**: a hub that doesn't start, as with a plant the program doesn't list (AC6's wrong-program test on the base
  and on any program without the plant); no deep-hook at `target/debug/deep-hook`; deep-hook check refusing a shipped
  entry; and AC6's world when the stop makes no claim within 60 s, or `changes.read` doesn't answer for it within 30 s.

## What the implementer adds outside this folder

- `scripts/lanes.mjs`:

  ```js
  // #1509's files each start a hub that gates dependencies against a registry served on loopback: one file at a time.
  alone.push('tests/acceptance/1509/');
  ```

- `packages/hub/src/plant.ts`: `asks-every-registry-run` in `Plant` and `PLANTS`.
- `packages/hub/src/server.ts`: `DEEP_HUB_TEST_REGISTRY` read beside `DEEP_HUB_TEST_FORGE`, as the registry's base URL.
- The twins named in `twins.json`, under `twins/`.

## On the base

Run twice, recorded in `BASE-FAILURE.txt`, at load averages from 16 to 201: all 8 tests fail and none reads
INCONCLUSIVE. Seven fail at an assertion in this folder; AC6's wrong-program test is BLOCKED, since the base's hub
refuses a plant it doesn't list. None fails at an import, a load error or a timeout.

- AC1 fails naming `npx -y some-pkg@latest`, which runs with no gate and no ask; its check-mode test fails because
  deep-hook reads none of the spellings as a dependency.
- AC2 fails at its contrast: `npx vitest@4.0.0` runs. `npx vitest` itself runs with no ask on the base, which reads no
  npx at all.
- AC3 fails naming `pip install -r requirements.txt`, held by an ask that reads `requirements.txt` as a package.
- AC4 fails because `npx -y some-pkg@latest` isn't held, before any question is read.
- AC5 fails naming the npx call: allowed with the hub stopped and recorded, but matched to no entry, while
  `npm install left-pad@1.3.0` is matched to `record-new-dependency`.
- AC6 fails at the return card's line: the stop made its claim and `changes.read` reads "Changed no files." The
  wrong-program test fails at its assertion only on the `plants-ignored` twin, which the implementer builds.

## Known limits

- Not asserted, because no criterion states them: the 7-day line itself (drafted; only 2 days and three years are
  read); when the name was first published, in the question; "read once by the hub with no credential" (the registry
  records each request, and nothing reads them); "a standing rule still answers these with no ask" (#23's suite covers
  a standing rule for `npm install`); the age on the return card's line; `pnpm install`, `yarn`, and `pip install -r`
  after a change to requirements.txt; the planted call and twin the design says each new form ships; the design line
  the Scope adds.
- Only npm's registry is served. The Python spellings are read only in check mode, and no hub here reads a Python
  package's registry; how the hub is pointed at one is the implementer's, inside `DEEP_HUB_TEST_REGISTRY`'s rule.
- No test has passed on any program. `DEEP_HUB_TEST_REGISTRY`, the registry's shape, the plant and the surface for the
  return card's line are this job's choices. An implementer who finds one unworkable for a reason the base can't show
  reports it as a redraft request and doesn't edit the tests.

## Files

- `helpers.ts`: the world, the fixture registry, the hub, the record, sessions and hooks, reading replies, late hooks,
  deep-hook's check mode, and the change a claim makes.
- `scenarios.ts`: each criterion's scenario, and the two outcomes a call has (`held`, `runsNoAsk`).
- `npx.test.ts` (AC1), `lockfile.test.ts` (AC2), `manifest.test.ts` (AC3), `registry.test.ts` (AC4),
  `hub-down.test.ts` (AC5), `old-version.test.ts` (AC6 and its wrong program).
- `fixtures/agent.mjs`: one session's Claude Code, from #321 by way of #23 (same repo, same license).
- `fixtures/stub-bin.sh`: the stand-in for `claude` and `codex` on every child's `PATH`.
- `twins.json`, `tsconfig.json`, `BASE-FAILURE.txt`.

No fixture holds a secret or personal data: homes, paths, package names and the registry are made up or the issue's.
