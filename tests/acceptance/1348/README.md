# Acceptance tests for #1348: one plain set of words for everyone

What a person sees says task, ready and needs you, never repo, PR or commit, with the detail a click away.

Written first and blind, at base commit `ede4b367` (origin/main), from issue #1348 (its text, Scope, four acceptance
criteria and Proof), the design and the base, before any implementation. The implementing agent does not edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- **The issue**: its problem, Scope (the word list, the plain surfaces, detail views, problems told plainly, the lane,
  no setting, States people see outside the lane), the four criteria and Proof ("Every string a fixture run shows a
  person, listed against the word list").
- **The design**, `docs/technical-design.md`: States people see (the one row shape, what `deep` with no arguments
  prints, every term carrying its plain meaning), the "One input" and "The project page" bullets (the one card; the page,
  the card, notifications and end notices using one list of plain words kept in the repo; a lane failing a listed word;
  a problem told as what happened and what happens next; detail views keeping the real names), How it installs, and
  Dogfooding. `docs/canvas-primitives.md`, One word per idea.
- **The base**, for its surfaces only: `scripts/lanes.mjs` (`checks`, each lane a `{name, commands}`), `contracts/`
  (repo-wide data), `packages/hub/src/plant.ts` (`DEEP_HUB_PLANT`, the planted programs tests select),
  `crates/deep-app` (`states.rs`, `notify.rs`, `card.rs`, `views.rs`, the `env-plants` feature that reads
  `DEEP_HUB_PLANT`), `crates/deep-replica` (the headless replica and its text snapshot of every name and value a view
  draws), `packages/cli/src/main.ts` (`deep` with no arguments prints the usage at the base), and the suites `1172`,
  `994` and `352` for their conventions.

## How to run

With Node 24.22 first on `PATH`, `npm ci`, and whatever the lane itself needs built (its own business: the tests run
its commands as `scripts/lanes.mjs` lists them, so a lane that builds what it reads needs nothing here):

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1348
node node_modules/typescript/bin/tsc -p tests/acceptance/1348/tsconfig.json
```

- Four lane runs in all: one with no plant (`fixture.test.ts`, shared by its three tests) and one per plant
  (`plants.test.ts`). Each run may take up to 40 minutes (a first build of the app); the tests wait 45.
- The lane's runs build and draw, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`). The
  implementer adds it; this job edits nothing outside this folder.
- Every run gets a fresh temp file for its dump, removed after. The tests start no hub, touch no home and kill
  nothing; whatever the lane starts, it stops itself, by PID.
- Vitest writes `tests/acceptance/1348/node_modules/.vite/` under `--root`; delete it before committing.

## The contract (my choice, since the issue and design name no path or entry point)

The design names the surfaces (the word list "kept in the repo", "a lane fails a listed word on those surfaces") but no
path, lane name or dump. These are the smallest the base suggests. The implementation must provide exactly these.

1. **The word list: `contracts/plain-words.json`**, beside the base's other repo-wide data in `contracts/`, readable by the
   hub, the CLI and the app alike. Shape: `{"words": {"<internal word>": "<plain word>", ...}}`. It must map at least
   `issue`, `PR`, `commit`, `branch`, `landed`, `verdict`, `session` and `repo` (the words the issue names), with
   exactly `issue` → `task`, `landed` → `finished`, `verdict` → `result` and `session` → `agent at work` (the issue's
   own). Every value is a non-empty string. Other entries are the implementer's.
2. **The lane: an entry named exactly `plain words` in `checks` of `scripts/lanes.mjs`.** The tests import `checks`,
   find it by name, and run its `commands` in order from the repo's root, as a lane does; its status is the first
   non-zero exit, else 0. Its commands are the implementer's. The lane runs **a fixture run of its own** through the real
   surfaces and judges every string they show against the word list:
   - it exits non-zero when a string on a **plain surface** (`card`, `page`, `notification`, `end_notice`, `deep`)
     holds a listed word, or shows a stack trace, and exits 0 otherwise;
   - strings on every other surface (a session's page, evidence, anything opened from a row) are detail and never fail
     it, whatever they hold;
   - for each string it fails, it prints **one output line** (stdout or stderr) holding the string verbatim and, for a
     listed word, that word's plain word from the list; for a stack trace, the trace's line(s) as shown.
3. **The dump: when `DEEP_PLAIN_WORDS_DUMP=<file>` is set, the lane writes every string its fixture run showed to
   `<file>`** (pass or fail), as JSON:

   ```json
   {
     "shown": [
       { "surface": "card", "text": "..." },
       { "surface": "page", "text": "...", "row": "<row id>" },
       { "surface": "notification", "text": "..." },
       { "surface": "end_notice", "text": "..." },
       { "surface": "session_page", "text": "..." },
       { "surface": "detail", "text": "...", "row": "<row id>" }
     ],
     "rows": [ { "id": "<row id>", "problem": null }, { "id": "<row id>", "problem": { "happened": "...", "next": "..." } } ]
   }
   ```

   - `shown` is every string a person sees on each surface, read from what the real component draws (the replica's
     text snapshot of a view, the notification's and end notice's text as posted, `deep`'s stdout), not a copy of the
     model it draws from: a string a view adds on its own must be in it. Surface names: `card` (the one card), `page`
     (the project page), `notification`, `end_notice`, `deep` (`deep` with no arguments), `session_page` (a session's
     page), `detail` (what one click on a page row opens); any other name counts as a detail view.
   - Every `page` string that belongs to a row carries that row's `row` id. Every `detail` string carries the id of the
     row whose **one click** opened it: the strings of the view that click shows, after that click and no other.
   - `rows` lists every row on the page, once each, with `problem`: `null`, or for a row that tells a problem, the line
     saying what happened and the line saying what happens next, each exactly as the row shows it (each a substring of
     one of that row's `page` strings).
4. **The fixture run** is the lane's own and the implementer's, with these in it: the one card, the project page with at
   least two rows, at least one notification and the run's end notice, each showing at least one string; real names
   (an issue, a PR, a branch, a commit or a session) on the detail views; and a task titled exactly **`Cart totals`**
   whose failure's output is exactly [`fixtures/trace.txt`](fixtures/trace.txt), a three-line stack trace (read it from
   there). The run's other tasks, titles and events are free.
5. **Plants, selected by `DEEP_HUB_PLANT`** as the base's plants are (the hub's `plant.ts`, the app's `env-plants`
   feature), read only in a build the lane makes for tests and never in a release build. Each lives in the component
   that draws its surface, not in the lane's script, so the dump shows it only if the surface drew it:
   - `card-line-pr`: the card shows one more line, exactly `PR #12 is ready for review`. A wrong program.
   - `session-page-line-pr`: a session's page shows that same line, exactly. Not a wrong program: detail keeps real names.
   - `page-shows-trace`: the page row of `Cart totals` also shows the failure's stack trace, as the trace reads in
     `fixtures/trace.txt` (whole, or line by line). A wrong program.

## Criterion to tests

| Criterion | Test | Wrong programs it fails on |
|---|---|---|
| AC1, first sentence | `plants.test.ts`, "a planted card line holding "PR" fails the lane…": `card-line-pr`; the card in the dump holds the line, the lane exits non-zero, and one output line holds the string and the list's plain word for `PR` | a lane that passes everything; a lane that names the word but not the string or not its plain word; an empty or gutted word list (`words()` fails first); a build that ignores the plant (the dump lacks the line) |
| AC1, second sentence | `plants.test.ts`, "the same word on a session's page passes": `session-page-line-pr`; the session page in the dump holds the line, no plain surface does, and the lane exits 0 | a lane that fails a listed word on every surface, detail views included |
| AC2 | `fixture.test.ts`: no plant; each of card, page, notification and end notice shows ≥ 1 string; no string on a plain surface holds a listed word, matched here against the list (whole word, any case, plural `s`/`es`); the run's detail views hold ≥ 1 listed word; the lane exits 0 | a surface left in developer words; a surface missing from the dump; a fixture run with no real names to translate; a lane that fails the clean run |
| AC3, first sentence | `fixture.test.ts`: the page row showing `Cart totals` has a `problem` whose `happened` and `next` are each one non-empty line, shown in that row, different, with no listed word, path or code; no plain surface shows any piece of the trace; one click on that row shows the trace's first line | a page that prints the trace; a row with no problem line, or none for what happens next; a program that drops the failure's detail altogether |
| AC3, second sentence | `plants.test.ts`, "a view that shows the trace fails, naming it": `page-shows-trace`; the page in the dump shows the trace, the lane exits non-zero, and an output line holds a line of the trace. It first checks the trace holds no listed word, so the lane must catch it as a trace | a lane that checks words only; a lane that fails without naming what it found |
| AC4 | `fixture.test.ts`: ≥ 2 rows with unique ids; each row is on the page, its one-click `detail` is non-empty, and holds ≥ 1 listed word, a real name | a row that opens nothing in one click; a detail translated into plain words; a page with a single row |

No test passes when the lane is missing (`BLOCKED: scripts/lanes.mjs lists no lane named "plain words"`), when the word
list is missing (`BLOCKED: no word list at …`), or when the lane writes no dump or a malformed one.

Each test was run against a throwaway twin of the lane (a script in a scratch folder, a temporary word list and a
temporary `checks` entry, all removed; nothing of it is committed): the right twin passed all six, and each wrong twin
failed the test the table names for it (a lane passing everything: AC1 first and AC3 second; a listed word on the page:
AC2; a problem with no next line: AC3 first; a row with no detail: AC4). That shows the tests' own logic, not any
implementation.

## Disputes and assumptions a redraft may revisit

1. **The dump is the lane's, not a GUI read.** A "dump of every string shown" from the real component (the issue's
   Proof and the brief allow it), so the tests start no window. The contract asks for strings read from what each
   component draws, and the plants live in the components, so a dump copied from a model would miss them; but a test
   can't see past the dump itself, and a lane that fakes its dump and its plants together would pass. A review of the
   lane's source is the guard there.
2. **"In one click" is the dump's word.** The `detail` strings are, by contract, what one click on the row shows; the
   tests read them, they don't click. A real-window test (as #1172 reads its app) would see the click itself, at the cost
   of OS permissions and minutes a run.
3. **The fixture run is the implementer's,** since the card, the project page and the run's end notice (#1341, #1342,
   #1343) have no record shape at the base for a test to write one. The tests hold it to the minimum above, and pin the
   failure (`Cart totals`, `fixtures/trace.txt`) and the plants' text.
4. **"Real names" means listed words.** AC4 counts a detail as keeping real names when it holds at least one word on the
   list. A row whose only detail is a plain card fails it; the design says anything opened from a row is a detail view.
5. **Matching.** The tests' own match is a whole word, any case, with an `s` or `es` ending. A lane may match more
   widely; one that matches less (case-sensitive only, say) can fail AC2 on a string the tests catch.
6. **"What happens next" is read for its shape,** a second line in the row that differs from what happened, not for its
   meaning. A path is `/a/b` (with `~`, `.` or `..` before it); code is a backtick, `=>`, `::`, a call `name(…)` or
   `file.ext:line`.
7. **Not covered by a criterion, so not tested:** `deep` with no arguments (a plain surface the lane covers; AC2 names
   only the four), the words of States people see staying as they are, `deep status`, `deep doctor` and `--help` staying
   outside the lane, and the absence of a setting to choose the words.

## Files

- `helpers.ts`: the word list, the lane run, the dump's shape, the tests' own matching, the criteria's IDs.
- `plants.test.ts` (AC1, AC3's second sentence), `fixture.test.ts` (AC2, AC3's first sentence, AC4).
- `fixtures/trace.txt`: the planted failure's stack trace, which the fixture run reads.
- `tsconfig.json`: as #352's. `BASE-FAILURE.txt`: the run at the base.
