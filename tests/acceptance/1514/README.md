# Acceptance tests for #1514: rule lines an agent never gets, named by the doctor and on the rules page

Written blind, before any implementation, from issue #1514 (Scope, its seven acceptance criteria, Proof, Depends on),
`AGENTS.md` and `docs/technical-design.md` ("What each agent gives us, and the limits we design around", with Health
reads the agent's side, Facts as data and What a session loads; the "Your written rules, enforced" bullet; "How we know
version 0 works"), with #1453 for "no new page or row shape". The base is `f6ddd396` (origin/main), with no
implementation of #1514. At the base I read, for their surfaces only: `packages/hub/src/doctor.ts`, `rules.ts`,
`session-memory.ts` (the start slice), `wiki-build.ts` (Claude Code's memory folders), `session-facts.ts`,
`socket-adapters.ts` (`DEEP_HUB_TEST_FACTS`), `codex-settings.ts` (`codexTrusted`) and `plant.ts`;
`packages/adapters/src/facts.ts`; `packages/record/src/index.ts` (`openRecord`, the catalogue check); `scripts/corpus.mjs`
(`check`) and `scripts/proof-change.mjs` (`criterionId`); and the suites of #19 (doctor), #1296, #344, #303 and #1033.
The implementing agent doesn't edit these files; a dispute goes to a blind redraft.

## How to run

```sh
npm ci                                   # once
npm run build --workspaces               # the deep CLI, the hub and the doctor run from packages/*/dist
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook   # the sessions' hooks
node node_modules/vitest/vitest.mjs run tests/acceptance/1514/ --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1514/tsconfig.json
```

The files start hubs, sessions and `deep setup`, so the folder belongs on `scripts/lanes.mjs`'s `alone` list. No
network, no model call, no real `claude` or `codex` (#19's stand-ins answer `--version`, `auth status` and `-p`).
Folders go under `/tmp/dh19d-*` (#19's world), `/tmp/dh303-*` (#344's) and the OS temp dir (`dh1514f-*`); each
world's `cleanup` stops what it started, by PID, and removes its folders.

## The surface under test

Names the issue or a merged suite gives are used as they are. Each name this job chose is marked *(chosen)*.

- **`deep doctor --json --prompt`** (#19), run with its working folder in the fixture repo, in #19's all-ok world
  (`../19/doctor/helpers.ts`, `world`, imported): one doctor.item@1 per line. The item the issue names is one whose
  `item` is `rules.not_loaded`, or whose `code` is `not_loaded`, `rules.not_loaded` or `rules_not_loaded` (#1296
  took a name as the item or the code). Its level isn't `ok`. It names its agent in `agent` or in its words
  (`evidence` and `fix`). Its words name the file, and the first line lost as `line <n>`, `lines <n>…` or
  `<file>:<n>` *(chosen)*. AC7's item also names the byte limit, as `25000` or `25,000`.
- **Where the doctor runs for Codex's budget** *(chosen)*: in the nested folder, `packages/core`. Codex reads the
  AGENTS.md files from the repo's root down to where it runs, so both files load there. A doctor that walks the whole
  repo reports the same there.
- **`deep rules sync`** and the rules page, `<home>/.deepbuild/wiki/rules.md` (#344): each rule is a claim line
  `- <text> <!-- deep:claim {...} -->`, found here by its text. A repo is on the page once a session ran in it (#344's
  surface 1), so each page test first starts a Claude Code session in the repo.
- **The mark** *(chosen)*: no new page and no new line (#1453). The rule's claim JSON gains `not_loaded` (also spelled
  `notLoaded`): a list of `{"agent": ..., "cause": ...}`, one entry per agent the rule-load entry says won't load that
  line. `agent` names the agent: `claude` or `codex` in any case, since Claude Code's facts call it `claude` and its
  doctor items call it `claude-code`. `cause` names the cause in words: `budget` for over budget, `shadow` for shadowed
  by another file, `index` for past the index limit, and `untrusted`, `not trusted` or `n't trust` for project not
  trusted. A line the entry says loads carries no `not_loaded` entry for that agent.
- **A recorded load on the page** *(chosen)*: when a recorded native load event shows a line loaded, the line has no
  `not_loaded` entry for that agent. Instead it carries `loaded`, a list of `{"agent": ..., "session":
  "session:<id>"}` naming the session whose record holds the event. That is "reads as loaded, and the page says so".
- **The native load event** *(chosen)*: `session.loaded`, version 1, in the existing `session` family, with subject
  `session:<id>` and data `{"files": [{"path": "<absolute path>"}]}`, each file one the agent reports it loaded,
  whole. The test appends it, after the Codex session's `session.start` (v1, `worktree` the nested folder), through
  the record's public entry (`openRecord` from `packages/record/src/index.ts`, as #344's helpers seed sessions)
  while no hub runs. It writes it as the hook writer (an adapter maps its agent's own report), or as the core when
  the record takes it only from the core. It doesn't go through deep-hook: no agent's facts at the base name a hook
  or transcript entry that reports what loaded, and Codex, the agent with a budget, has no hook for it.
- **The rule-load entry** *(chosen)*: a top-level key `ruleLoad` (also `rule_load`, `ruleLoads`) in each agent's
  facts (`adapters/claude-code.facts.json`, `adapters/codex.facts.json` and the other agents'), shaped per version
  as the implementer sees fit. The tests set only these leaves, wherever they sit inside it:
  - Codex's byte budget `capBytes` (also `maxBytes`, `budgetBytes`, `limitBytes`), outside any memory index.
  - Under Claude Code's `memoryIndex` (also `memory_index`), the line cap `capLines` (also `maxLines`, `limitLines`)
    and the byte cap `capBytes`.

  Everything else is read from the shipped entry unchanged: a version's shared budget, which file wins, what stops a
  load and the settings that change it.
- **The fixture facts** *(chosen)*: `DEEP_HUB_TEST_FACTS=<folder>`, the hub's existing seam (`socket-adapters.ts`,
  set only by tests). #19's world sets it on every process it starts: the hub, `deep setup`, `deep doctor` and
  deep-hook. The folder holds a copy of every `adapters/*.facts.json` with only the entry a criterion fixes changed.
  For AC1, AC2 and AC6, Codex's `capBytes` is 32,768 (32 KiB). For AC4 and AC7, Claude Code's `memoryIndex` is 200
  lines and 25,000 bytes. The implementer makes the rule-load entries that the doctor and the rules page read come
  from that folder when it is set. When a shipped file lacks those leaves, each test says so in a soft assertion
  naming what is missing, and goes on with the copy unchanged.
- **Codex's trust**: `[projects."<path>"]` with `trust_level = "trusted"` or `"untrusted"` in `<home>/.codex/config.toml`
  (#322's reader). The tests write it for the repo and for its nested folder *(chosen)*, so a reader keyed on either
  finds it.
- **Claude Code's memory index**: `MEMORY.md` in `<home>/.claude/projects/<the repo's path, each non-alphanumeric
  character as ->/memory/`, the folders `wiki-build.ts` reads and Claude Code's facts' `transcripts.path` names. It is
  the index of the repo the doctor runs in and a session ran in.
- **#344's route** (AC3): a Claude Code session through the built deep-hook (#303's `Session`), what its SessionStart
  and first prompt are told, and `session.rules_delivered` naming the rule's handle `wiki:rules#<id>`.
- **`node scripts/corpus.mjs check --facts <dir>`**: the adapter-facts conformance case, with its `FAIL` lines and the
  `Fix:` line under each (#1033, #1296).

## Criteria to tests

Each ID is `scripts/proof-change.mjs`'s `criterionId`: `#1514.` and the first 8 hex digits of the SHA-256 of the
criterion's text, trimmed, white space collapsed. Each test's name starts with its `AC<n> #1514.<h8>`.

| Criterion | File | Test | Wrong program, and how it fails |
|---|---|---|---|
| AC1 `#1514.63e8c235` (40 KiB of AGENTS.md under a 32 KiB budget: the doctor names the nested file and line, exits non-zero) | `budget.test.ts` | the doctor in `packages/core` names `packages/core/AGENTS.md` and line 193 for Codex, exit non-zero | `doctor-sums-per-file` reads OK and fails at `AC1 deep doctor run in … must report rules.not_loaded for Codex naming packages/core/AGENTS.md` |
| AC2 `#1514.1c915faf` (the same repo, untrusted: every rule not reaching Codex, cause untrusted) | `budget.test.ts` | each of the 20 rules of both files is marked for Codex, cause untrusted | a page with no mark, or the wrong cause: fails naming the line and file |
| AC3 `#1514.cf1be8d6` (CLAUDE.md beside AGENTS.md: AGENTS.md's rules shadowed for Claude Code; "never force-push" still reaches the session) | `shadowed.test.ts` | both AGENTS.md rules marked for Claude Code, shadowed, and CLAUDE.md's not; a session started after is told "never force-push", and its record names the delivery | a page with no mark, or one marking CLAUDE.md; a hub that stops delivering the shadowed rule |
| AC4 `#1514.d19a73eb` (307-line index, 200-line limit: lines 201 on, naming 201) | `memory.test.ts` | the doctor names MEMORY.md and line 201 for Claude Code; the page marks lines 201 to 307, past the index limit, and none before | a doctor or page that doesn't read the index; a cut at another line |
| AC5 `#1514.57ce9222` (facts without the rule-load entry fail the conformance case, naming the field) | `facts.test.ts` | Codex's file, then Claude Code's, without `ruleLoad`: a FAIL line names the field and the agent; the shipped files carry it, and the check on them names no such field | a case that never names the field; one that always does (the control) |
| AC6 `#1514.26da020e` (a rule marked over budget that a recorded native load shows loaded reads as loaded, and the page says so) | `budget.test.ts` | nested line 225 is marked over budget for Codex; after `session.loaded` in a Codex session's record it has no mark for Codex and a `loaded` entry naming that session | a page that keeps the prediction, or says loaded without naming the record |
| AC7 `#1514.a1d1911e` (150 lines of 300 bytes under 200 lines and 25,000 bytes: lines 84 on, naming 84 and the byte limit) | `memory.test.ts` | the doctor names MEMORY.md, line 84 and 25,000 for Claude Code; the page marks lines 84 to 150 and none before | `doctor-counts-lines-only` reads OK and fails at `AC7 deep doctor run in … must report rules.not_loaded for Claude Code naming its memory index` |

The tests check the issue's arithmetic on their fixtures, not only here. AC1's repo is 40,960 bytes together and
20,480 bytes a file, so each file alone is under 32,768 bytes and line 193 is the nested file's first line past the
budget (and a rule); AC2 and AC6 build the same repo. AC4's 307-line index is under 25,000 bytes, so line 201 is first
lost. In AC7's 150-line index each line is 300 bytes, line 83 ends at byte 24,900 and line 84 at 25,200, so line 84
is first lost.

## Wrong programs the implementer adds

The AC1 and AC7 plant names are *(chosen)*. They go in `packages/hub/src/plant.ts` (`Plant` and `PLANTS`), and the
doctor's process reads them (the variable is set on the doctor only), as #1296's `statusline-user-settings-only` was.

| Name | Criterion | What it does wrong | How its test fails |
|---|---|---|---|
| `doctor-sums-per-file` | AC1 | checks each AGENTS.md against Codex's byte cap on its own, never the budget the files share, so each 20 KiB file fits | it reports no rules.not_loaded item above ok, and the AC1 judgment fails at its first assertion |
| `doctor-counts-lines-only` | AC7 | checks a memory index against its line cap only, so the 150-line index fits | it reports MEMORY.md OK, and the AC7 doctor judgment fails at its first assertion |

`twins.json` names, for AC1 and AC7, `always-<plant>` (the implementer's `plant.ts` with the plant always on, so the
criterion's own test fails) and `plants-ignored` (with every plant off, so the wrong-program test fails), as #19's
twins do. The implementer builds those folders under `twins/` on its own `plant.ts`, since a copy of the base's would
go stale. At the base each wrong-program test fails only at the soft facts assertion: the base reports no rules item,
so the planted doctor's "reads OK" and the judgment's failure both hold there.

## Readings where the issue leaves a choice

1. **"Its first line past the budget"** is the first line not wholly within it. Codex reads the root file first,
   then the nested one, counting each file's bytes and nothing between them (it joins them with a blank line it
   doesn't count). The fixture ends the budget exactly at the end of line 192, so line 193 is first lost whether a cut
   line counts as lost or not, and line 193 is a rule.
2. **"Reports every rule"** (AC2) is read on the rules page, where every rule is listed: every bullet of both files.
   The doctor's half of the scope isn't asserted for AC2.
3. **"Marks lines 201 on … naming line 201"** (AC4) and **"marks lines 84 on … naming line 84 and the byte limit"**
   (AC7). "Marks" is the rules page: a mark on each line from that line on, and none before it. "Naming" is the
   doctor's rules.not_loaded item, since the scope has the doctor name the file and the first line lost, and AC7's
   wrong program is a doctor. A line cut part way through is lost: line 84 starts inside 25,000 bytes and ends past
   them. Each memory index line is a bullet, so each is a rule on the page.
4. **AC6's "the page"** is the rules page, where the mark sits. The mark goes, and the line names the session whose
   record holds the load.
5. **AC3's "where the facts say so for that version and its `instructionFiles` setting is the default"**: the shipped
   facts; the sessions at the newest version Claude Code's facts cover (#303's transcript entries); and no
   `instructionFiles` in any settings file, since none exists in #344's world. "Still reaches the session" means a
   session started after the page marks the rule is told it at SessionStart or its first prompt, and its record
   names the delivery, by any `via`.
6. **A project Codex doesn't trust** has `trust_level = "untrusted"`, not a missing table.
7. **The exit** (AC1): the doctor must exit non-zero. At this base #19's world isn't all ok (the canvas items fail with
   the canvas binaries unbuilt), so the doctor exits 1 in every repo, and the assertion proves nothing until the canvas
   is built, as #1296's README (choice 2) says of its own.
8. **The marks are per agent with a rule-load entry**, whether or not that agent ran a session in the repo. The page
   tests' sessions are Claude Code's.

## Known limits

- Not asserted, because no criterion states them: a non-default `instructionFiles` lifting the shadow; the session
  facts digest reading the same entry; a session's page marking a prediction as one; Claude Code's shipped 200 lines
  and 25 KB; each entry naming the version it was read from (the Proof). The doctor's report for an untrusted
  project isn't asserted either.
- The native load event is seeded into the record, not produced from an agent's report, since no agent's facts
  at the base name one. Which hook or transcript entry an adapter maps to `session.loaded` is the implementer's.
- The wrong programs are planted by `DEEP_HUB_PLANT`, the convention every doctor plant here follows, though the
  design's Wrong programs paragraph says a planted program is never chosen by an environment variable.
- No test has passed on any program. The marks, the event and the entry's leaves are surfaces this job chose. An
  implementer who finds one unworkable for a reason the base can't show reports it as a redraft request and doesn't
  edit the tests.

## What the implementer adds outside this folder

- `scripts/lanes.mjs`: `'tests/acceptance/1514/'` on `alone`.
- `packages/hub/src/plant.ts`: `doctor-sums-per-file` and `doctor-counts-lines-only`, read in the doctor.
- `packages/contracts/schemas/doctor.item@1.json`: the code of the rules.not_loaded item (such as `not_loaded`); and in
  `packages/hub/src/doctor.ts`, the exit: a lost line makes the doctor exit non-zero.
- `packages/contracts`: `session.loaded@1` in the catalogue, data `{files: [{path}]}`, with subject `session:<id>`.
- `adapters/*.facts.json`: `ruleLoad` in each agent's facts, the `adapter.facts@N` schema that names it, and the
  case in `scripts/corpus.mjs check` that fails a facts file without it, naming the field and the file.
- `DEEP_HUB_TEST_FACTS` read wherever the doctor and the rules page read the rule-load entry.
- The twins named in `twins.json`, under `twins/`.

## On the base

Run once, recorded in `BASE-FAILURE.txt`: 9 of 9 tests fail, each at an assertion, none at an import. AC1, AC4 and
AC7 fail at the doctor, which has no rules.not_loaded item. AC2 and AC6 fail at the page, which lists the rules with
no mark. AC3 fails at the missing shadowed mark; its delivery half already holds at the base. AC5 fails because no
FAIL line names `ruleLoad`. Every test in a #19 world also reports, softly, that the shipped facts have no rule-load
entry. The two wrong-program tests fail only there.

## Files

`helpers.ts` (tags, fixtures and their arithmetic, the fixture facts, the page reader and marks, the doctor's items,
the native load event), `budget.test.ts` (AC1, AC2, AC6), `memory.test.ts` (AC4, AC7), `shadowed.test.ts` (AC3),
`facts.test.ts` (AC5), `twins.json`, `tsconfig.json`, `BASE-FAILURE.txt`. No fixture holds a secret or personal data;
homes, paths and rule texts are made up.
