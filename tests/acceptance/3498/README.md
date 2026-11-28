# Acceptance tests for #3498: a row's own sentence holds no listed word

Written first and blind, at base commit `4307d749c` (origin/main at `03b71e900` merged with the design text #3472 decided), from
issue #3498 as saved on 2026-11-27 (its opening paragraph, its table of seven sentences, Scope, `Runs on:` line, five acceptance
criteria and Proof; it has no comments), the design and the base, before any implementation. The implementing agent does not
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #3498, and the issues it names, for this task's edge only: #3472 (where it was decided), #1324 (its epic), #3495, #3496,
  #3497 and #3418 (beside it), #1348 (which it depends on).
- `docs/technical-design.md` at the base: States people see (the table, the row shape, the one ordered state table, a row's one
  flag), What a person reads on a plain surface (above all "Who holds a row's sentence to the list"), One hub per user, Wrong
  programs, Dogfooding, Tests written first. `docs/parallel-proof.md`, sections 5 to 7. `AGENTS.md`, `CONTRIBUTING.md`,
  `GLOSSARY.md`.
- At the base: `packages/hub/src/{status,rows,list,watch,plant,sections}.ts`, `packages/record/src/projections.ts`,
  `packages/contracts/{code-words.json,fixtures,src/schemas.ts}`, `contracts/plain-words.json`, `crates/deep-app/src/{plain,copy}.rs`,
  `crates/deep-app/copy/en.json`, `scripts/{lanes,lanes-lists,app-copy-lint,copy-table,twins-lint,proof-runs,wait-ratchet,throttle}.mjs`,
  `packages/hub/test/{state-table,flags}.test.ts`, and the suites `3472`, `2403`, `1463`, `2018`, `2019`, `1458`, `1348`, `1808`.

Nothing outside these was read: no other checkout, branch, pull request or run of the work.

## What the base does

- **No check and no set.** `scripts/row-sentence-lint.mjs` and `packages/hub/row-sentences.json` are not there. Each sentence is
  written inline in the rule that picks the state or the flag (`packages/hub/src/status.ts`, `TABLE` and `FLAGS`; a watch-only
  flag's words in `packages/hub/src/watch.ts`).
- **The seven sentences** are at lines 138, 165, 169, 174, 176, 188 and 267 of `packages/hub/src/status.ts` (the issue read
  them at `e34816f67`, two lines lower each). Line 267 holds the unpushed flag's words and its fix.
- **What `deep` prints.** On this suite's fixture record (below) the hub's rows print, each after its title and its agent:
  `PASS · its claim passed its checks`, `sent back · its checks sent its claim back, round 1 of 3`,
  `says done · it says done, and its checks have given no verdict yet`, `stale · its verdict is on a commit that has moved since`,
  `finished · unpushed: 2 commits on no remote branch. Push the branch, or say why it stays here. · its turn stopped`,
  `flagged · its turn ended failed, with no claim (for a reason its agent didn't give)` and
  `BLOCKED · waits for you: its verdict names no evidence`, each then `, 5m`.
- **The app's table** holds a `hub.` entry for most whys (`hub.moved_commit`, `hub.claim_passed`, …) and none for a flag's words.
- **Each row that isn't PASS has a `waits_on`** (`agent`, `its checks`, `you`), and PASS has `null`.

## How to run

With Node 24.22 first on `PATH` and the TypeScript workspaces built (`npm run build --workspaces --if-present`; no cargo, no
replica, no app, any machine):

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3498 --no-file-parallelism --testTimeout=600000 check.test.ts
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3498 --no-file-parallelism --testTimeout=600000 print.test.ts
DA3498_SHOWN=<a folder to keep> NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3498 --no-file-parallelism --testTimeout=600000 shown.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/3498
```

| File | Criteria | Needs built | Takes at the base |
|---|---|---|---|
| `check.test.ts` | AC1, AC2, AC4 | nothing: it reads files, runs `git archive` and runs a script of `scripts/` | 2 to 4 s (every test stops BLOCKED) |
| `print.test.ts` | AC3 | the workspaces: the hub's source reads `packages/evidence/dist/patterns.json`, a build output | 1 to 2 s |
| `shown.test.ts` | AC5 | the same | under 1 s |

- **Folders.** Planted trees, the merge base's files and the fixture record go under `/tmp/da3498-*`, removed when the file
  ends. `DA3498_SHOWN` names a folder that is kept: `merge-base-check.txt` (AC1), `before.txt` and `after.txt` (AC5). Without
  it they go to a temp folder and the run prints them. Nothing touches `~/.deepbuild`. No process outlives its test: the only
  children are the check's, git's and tar's, each waited for, and the check's stopped by PID at its deadline.
- **`--root` cache.** Vitest writes `tests/acceptance/3498/node_modules/`; delete it before committing.
- **No `lane.json`.** A suite's own lane file says only that it runs alone, with `binary`, `timing` or `shared: <resource>` as
  its reason, or names its timed and slow files (`docs/parallel-proof.md`, A suite's own lane file; `scripts/lanes-lists.mjs`
  reads no other shape). This suite builds no binary, starts no hub, times nothing, shares nothing and has no file over two
  minutes, so it runs in the unit lane beside the others and a lane file would say something untrue. `scripts/lanes-lists.mjs`
  needs no entry for it either.
- **No `twins.json`.** A twin's lines are written against the file as the change holds it, which this job never sees. Each
  planted thing here is planted input a test hands the real program (below).

## The surface (my choice where the issue names none)

The check is run as the lint lane runs it, from this checkout, on this checkout and on trees a test writes under `/tmp`. The
print is the hub's own: a fixture record written through the record core, read by the hub's one state reading, built into rows
by the hub's one row builder and printed by the function `deep` with no arguments prints through. No hub process and no model.

### Pinned here: the implementation must provide these

1. **The check's command.** `node scripts/row-sentence-lint.mjs` judges this checkout. `node scripts/row-sentence-lint.mjs
   --root <dir>` judges the tree under `<dir>` in its place, run from this checkout. With nothing wrong it exits 0 and
   prints no line that starts with `FAIL`. Otherwise it exits 1 and prints, on stdout, one or more lines that start with `FAIL`.
   The tests read only those lines and the exit code; the words after `FAIL` are the implementer's, as in
   `FAIL row sentences: template planted_3498_look holds "PR"; say "change to look at"`.
2. **The closed set.** `packages/hub/row-sentences.json`, one JSON object whose member `templates` maps each template's name to
   its English text, as in `{ "templates": { "turn_stopped": "its turn stopped" } }`. A test reads it with
   `JSON.parse(text).templates` and plants a template by adding one member, a name and a string, and writing the file back.
   The names the tests add are `planted_3498_look` and `planted_3498_no_entry`. How a template marks what fills it is not
   pinned: the planted texts hold no placeholder.
3. **A template's entry in the app's table.** `crates/deep-app/copy/en.json` holds the key `hub.<name>` whose English is the
   template's text, as in `"hub.turn_stopped": "its turn stopped"`. A test gives a planted template its entry by adding exactly
   that key and text and writing the table back with its keys sorted. A check that finds the entry by its English alone passes
   the same tests.
4. **What a tree under `--root` holds**, and so all the check may need there: `contracts/`, `crates/deep-app/copy/` and, for
   each package under `packages/`, its top-level files and its `src/`. No `scripts/`, no `node_modules`, nothing built. (The
   merge base's tree holds all of `packages/`, as `git archive` writes it.) The
   list of plain words is read from `<dir>/contracts/plain-words.json`, and a listed word is found as
   `crates/deep-app/src/plain.rs` finds one: whole, in any case, or with a plural ending.
5. **A template that holds a listed word** gives a `FAIL` line that holds the template's name, whole, and the word's plain word
   (`change to look at` for `PR`).
6. **A template with no entry in the app's table** gives a `FAIL` line that holds the template's name, whole. The same template
   with its entry (3) gives none.
7. **A why written inline in a rule** gives a `FAIL` line that holds `packages/hub/src/status.ts:<line>`, the line the literal
   is on. Inline means an object in `packages/hub/src/status.ts` that gives `why:` a string literal, as the rules of the merge
   base's table do, wherever in the file it is. The test appends this line to a copy of the file:
   `const planted3498 = { rule: 'planted', state: 'flagged', lacks: 'no planted fact', match: (f: SessionFacts) => (f.gone ? { why: 'its planted step waits on you', since: f.last_seen, waits_on: 'you', facts: [f.gone] } : undefined) };`
8. **On the merge base's files**, which hold no `packages/hub/row-sentences.json`, the check does not stop at the missing set: it
   exits 1, and for each of the seven sentences its `FAIL` lines that hold `packages/hub/src/status.ts:<line>` hold, between
   them, each of the sentence's listed words and that word's plain word:

   | Line at the merge base | What a row says | Listed word, plain word |
   |---|---|---|
   | 138 | "waits for you: its verdict names no evidence" | verdict, result |
   | 165 | "its turn ended failed, with no claim" | claim, says done |
   | 169 | "its checks sent its claim back, round 1 of 3" | claim, says done |
   | 174 | "its verdict is on a commit that has moved since" | verdict, result; commit, saved change |
   | 176 | "it says done, and its checks have given no verdict yet" | verdict, result |
   | 188 | "its claim passed its checks" | claim, says done |
   | 267 | "2 commits on no remote branch" and "Push the branch, or say why it stays here." | commit, saved change; branch, draft |

   One line for a sentence or one for each word both pass, as does a line that names more words than these.
9. **The lint lane** of `scripts/lanes.mjs` (`checks`, the lane named `lint`) holds the command
   `[process.execPath, 'scripts/row-sentence-lint.mjs']`, those two parts and no more.
10. **The taste call.** `tests/acceptance/3498/TASTE.json`, in the form #2403's and #1808's have: `verdict` (`reads_right` or
    `reads_wrong`), `who`, `when`, and `files` with the SHA-256 of `before.txt` and of `after.txt` as one run of `shown.test.ts`
    printed them. `DA3498_SHOWN` names the folder that run keeps them in.

No plant name, no `DEEP_HUB_PLANT` value and no twin is pinned: the implementation adds nothing to `packages/hub/src/plant.ts`
for this suite.

### Merged surfaces, used as they are

These are the base's, and `print.test.ts` and `shown.test.ts` stop BLOCKED, naming the file and the function, if one is gone:

- `openRecord({ path, now })` of `packages/record/src/index.ts`, with `append`, `raw` and `close`; `fixtures(name)` of
  `packages/contracts/src/index.ts`, for each event's published shape.
- `sessionStates(query, now)` of `packages/hub/src/status.ts`; `buildRows(query, readings, [])` and `orderOf(row)` of
  `packages/hub/src/rows.ts`; `listText(rows, { now })` of `packages/hub/src/list.ts`, which is what `deep` with no arguments
  prints.
- The row shape: `id` (`session:<session ID>`), `title`, `agent`, `word`, `why`, `waits_on`, and `flag.code` on a flagged row.
- A session's line in the print starts with two spaces, its title and two spaces. The tests take out the title, the agent and
  the age at the line's end (`, 5m`), and read the rest. Where a part between ` · ` is the row's word, what follows it is the
  row's own sentence; a sentence a state leads with (#3495) is before the word and so is never read as the row's own.

These imports are by path, as the base's suites import a package's source (`2018`, `2616`, `2645`).

### The fixture

`helpers.ts`, `fixtureRecord`: a record in a temp folder, each event in its kind's published shape, times on a fixed clock one
second apart, read five minutes after the last. Every session starts (`session.start`), gets its title (`task.created`) and a
prompt (`user.ask`), and stops (`agent.stop`):

| Key | Title | What the record holds after the stop | Must read at the base and on the change |
|---|---|---|---|
| `pass` | Cart totals | `claim.made`, `verdict.made` PASS | `PASS` |
| `sentBack` | Checkout page | `claim.made`, `verdict.made` FAIL, `claim.sent_back` round 1 | `sent back` |
| `saysDone` | Release notes | `claim.made`, no verdict | `says done` |
| `stale` | Search box | `claim.made`, `verdict.made` PASS, `verdict.stale` | `stale` |
| `unpushed` | Invoice schema | no claim; `commits.unpushed` with 2 commits and no branch | the flag `unpushed`, whatever its word |
| `failed` | Login form | a stop whose outcome is failed, with no claim | `flagged` |
| `blocked` | Order history | `claim.made`, `verdict.made` BLOCKED with no reason, no smallest case and no open item | `BLOCKED` |

`print.test.ts` uses the first five, `shown.test.ts` all seven. A session that doesn't read its state or its flag stops the test
BLOCKED, naming the session, before any sentence is judged. The titles hold no listed word (checked), the unpushed session has
no branch, and no line is quoted, so no fill decides a test; the stop's cause on the `failed` row ("for a reason its agent
didn't give") is a fill from the contracts' code list and is shown, never judged.

## Criterion to tests

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#3498.66862eb2` | `check.test.ts`: the check run on the merge base's files (`git archive 03b71e900700d1c6347731cb43cecd094a00097c contracts crates/deep-app/copy packages`, extracted under `/tmp`) exits 1 and names each of the seven sentences by `packages/hub/src/status.ts:<line>` with each listed word and its plain word; the run (command, exit code, output) is printed and written to `merge-base-check.txt`. A second test: the check passes this checkout, and the lint lane runs it | the merge base itself; a check that stops at the missing set, misses a sentence, or names a line without its words. At the base both stop BLOCKED: the check is not there |
| AC2 | `#3498.a9609187` | `check.test.ts`: an unplanted copy passes; a copy with the template `planted_3498_look`, "its PR waits on you", and its entry in the app's table fails, a `FAIL` line holding the name and `change to look at`. A copy with the inline why of Pinned 7 appended to `packages/hub/src/status.ts` fails, a `FAIL` line holding that file and line | the planted template; the planted why. BLOCKED at the base |
| AC3 | `#3498.86739e65` | `print.test.ts`: on the five-session record no row's line holds a listed word; each row that isn't PASS has a `waits_on` and names somebody in its own sentence; the stale row with its `why` replaced by "nothing has moved since" fails that judge, the failure holding the row's ID and title and naming no other row | the merge base, naming each row with each listed word and its plain word (first test); the planted sentence (third test). The second and third pass at the base, as they should: its rows already say whom they wait for |
| AC4 | `#3498.0760395f` | `check.test.ts`: an unplanted copy passes; a copy with the template `planted_3498_no_entry` and its entry passes; the same copy without the entry fails, a `FAIL` line holding the name | the planted template. BLOCKED at the base |
| AC5 | `#3498.826f8cd5` | `shown.test.ts`: `shown/before.txt` holds the seven sentences as the issue gives them; the run writes `after.txt`, the seven as this checkout prints them, and prints both with the whole print; each of the seven is reworded; then `TASTE.json` decides | the merge base, naming each sentence it still prints; no call, no person, no time, or a call on other files reads INCONCLUSIVE; `reads_wrong` fails, quoting its note |

## Readings where the issue and the design leave a choice

1. **"The check."** The issue names no script. `scripts/row-sentence-lint.mjs`, with `--root <dir>` as the base's lint checks
   take it and `FAIL` lines and exit codes as theirs.
2. **"One closed set of templates in one place."** A JSON file the hub reads beside its other data files (`packages/hub/tools.json`,
   `annotations.json`), so a check and a test can read every template with no build. A set kept in TypeScript source could not
   be planted blind.
3. **"Naming the template."** By its name in the set, whole: `planted_3498_look` is not named by `planted_3498_look_too`.
4. **"Naming the word and its plain word."** AC2 names the plain word only ("change to look at"), so only it is asked for.
   For AC1's "with its listed words" a line that only quotes the sentence would hold its words by accident, so each word must
   come with its plain word, which the Scope says the check names.
5. **"Naming each of the seven sentences"** (AC1). By file and line, which is how the Scope says a sentence outside the set is
   named, and on the merge base all seven are outside it. The line is where the sentence's text is in the merge base's file,
   found by its text, never a number written here.
6. **"The merge base."** Pinned by commit, `03b71e900700d1c6347731cb43cecd094a00097c`: origin/main where this suite was
   drafted, whose code the base commit holds unchanged. A merge base worked out when the test runs would become the change
   itself once it lands. A clone without that commit stops BLOCKED, naming it.
7. **"A why written inline in a rule."** Pinned 7. The planted rule is appended, since where the table sits after the change
   is not known here; its sentence holds no listed word, so only its being inline is wrong.
8. **"`deep` with no arguments prints."** The `Runs on:` line asks for unit tests on a fixture record, so the print is
   `listText` over the rows the hub builds from the record, with no hub process and no CLI process. That the CLI prints those
   rows through that function is #1463's suite's.
9. **"Prints no listed word."** Each of the five rows' lines, with the title, the agent and the age taken out. The lines `deep`
   writes around its rows (the headings "no repo" and "quiet, by repo", the count of sessions) are #3496's and are not read.
10. **"Says whom it waits for."** Two things, both of which the base's rows do. The row's `waits_on` is a non-empty string.
    And the row's own sentence, as printed after its word, holds one of `you`, `your`, `agent`, `it`, `its`, `check`, `checks`,
    `service`, as a whole word in any case, or the row's `waits_on` as written (an owner's name). `it` and `its` count because
    every sentence of the base names the session's agent that way. A sentence with none of them names nobody.
11. **"A planted sentence that names nobody."** Planted in test code: the hub's own rows with the stale row's `why` replaced,
    printed by the real `listText`. The stale row is the one whose leading sentence (#3495) names nobody either. It stands at
    the base, where the test passes. "Naming the row" is its ID and its title in the failure.
12. **"Before and after"** (AC5). Before is `shown/before.txt`, written from this suite's run at the base and held to the
    issue's seven sentences by the test. After is what the run prints. Each is one line a sentence, `<what the session is>`,
    two spaces, then the row's own sentence as printed after its word, so neither a leading sentence (#3495), a heading (#3496)
    nor an age changes the files a call binds to.
13. **"Reworded."** Each of the seven rows no longer prints its sentence as the issue's table gives it. No new wording is
    pinned anywhere.

## What isn't asserted, because no criterion says so

- That every sentence a row can carry is in the set, beyond AC1's seven and AC2's planted why: the other states' whys, the
  other four flags, a job's row and an ask's row.
- That what `deep` prints for a row reads as a template of the set, and how a template takes what fills it.
- The fifth Scope line: nothing judges a title, a quoted line, a branch's name or a stop's cause.
- The sixth: `deep status <session> --why` and the real names in the facts under its sentence.
- The seventh, past AC4: that a shipped template's entry in the app's table holds the same English, that another language has
  it, and that the app draws it.
- The check's own name in its lines, the lane's `fix` sentence, and a `PASS` line.
- That the print holds no listed word for any session but the five, or on any other surface.
- "Attached to the PR and shown to you": no test can see it.

## What the implementer adds outside this folder

- `scripts/row-sentence-lint.mjs` and its command in the lint lane of `scripts/lanes.mjs` (Pinned 1 and 9).
- `packages/hub/row-sentences.json` (Pinned 2), the hub's rules reading it, and each template's `hub.` entry in
  `crates/deep-app/copy/en.json` (Pinned 3).
- The record of the taste call in `tests/acceptance/3498/TASTE.json`, the one file of this folder that is filled in after
  the work.
- No edit to `scripts/lanes-lists.mjs`, to `packages/hub/src/plant.ts` or to any file of this folder but `TASTE.json`.

Found while reading, for the implementer and not judged here: beyond the seven, the base's watch-only flag holds listed words
in `packages/hub/src/watch.ts` ("no verdict blocks", "this repo's checks aren't approved, so none of its claims holds or
passes", and its fix, "Trust the repo in Needs you, …"), and AC1's "on this change it passes" reaches every template of the
set. The base also holds the seven sentences in `crates/deep-app/copy/en.json`, `packages/hub/test/{flags,state-table}.test.ts`,
`crates/deep-replica/fixtures/session-row.events.jsonl` and, among the suites, `1592`, `2019`, `2028`, `2668` and `3389`.

## Files

- `helpers.ts`: the IDs and every pinned name, once; the list of plain words and the rule that finds one; the check's run and
  its lines; the tree copies, the merge base's files and the plants; the fixture record and its print; the judges.
- `check.test.ts` (AC1, AC2, AC4), `print.test.ts` (AC3), `shown.test.ts` (AC5).
- `shown/before.txt`: the seven sentences as the merge base prints them. `TASTE.json`: the call, empty until a person makes it.
- `tsconfig.json`, `BASE-FAILURE.txt`.
