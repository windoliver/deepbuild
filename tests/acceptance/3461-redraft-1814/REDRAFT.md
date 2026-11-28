# #3461 criterion b4a5c8f4, blind redraft after #1814: the table finds each form's usage line by the form's own words, not by a pinned line start

#3461's third criterion, `#3461.b4a5c8f4`: "A table test gives every command `deep --help` lists each flag its usage
shows once, twice: with two values, and with one value repeated. Each prints that command's usage and exits 2, with
nothing on stdout. A planted reader that takes the first value and one that takes the last each fail, naming the
command and the flag". The first draft, `tests/acceptance/3461/table.test.ts`, names each form's usage line by the line's
start (`{ line: 'deep session rules', args: ['session', 'rules', …] }`) and fails the whole table BLOCKED when `deep
--help` shows no line with that start. #1814's Scope renames a listed command ("`deep session rules` becomes `deep rules
session`. The old form keeps working for one release"), unlists two (`deep inbox undo`, `deep memory overrule`), marks the
commands that ask for Touch ID or a password, and regroups the list. Under it the first draft is BLOCKED on a correct
program. This redraft keeps the criterion, the forms, the rows and the assertions, and changes only how a form finds
its line and how a usage line is read past a mark.

Written by a fresh run of the blind acceptance job, from issues #3461 and #1814, the design, `AGENTS.md`, the base
commit and the frozen first draft. I never read an implementation of #1814, a pull request, a branch, another worktree,
a diff or any commit but the base.

## What was read

- Base: `9bbe0f24c` (the merge of #3764), read 2026-11-28. Its sources with `git show 9bbe0f24c:<path>`; its built CLI
  run as `node packages/cli/dist/main.js`.
- Issue #3461 (`gh issue view 3461`): body, Scope, the five criteria. The tag, `sha256` of the criterion's text after
  `- [ ] ` with white space collapsed, begins `b4a5c8f4`.
- Issue #1814 (`gh issue view 1814`): body, Scope, the seven criteria.
- `AGENTS.md`; `docs/technical-design.md`'s Dogfooding part (a dispute goes to a fresh run of the job).
- The frozen first draft, read only: `tests/acceptance/3461/README.md`, `helpers.ts`, `table.test.ts`, `twins.json`,
  `twins/README.md` and `twins/first-wins-reader/lines.json`, `twins/last-wins-reader/lines.json`.
- For form: `tests/acceptance/1359-redraft-1812/REDRAFT.md`, `tests/acceptance/3461-redraft-once/` (REDRAFT.md,
  BASE-RESULTS.txt, twins.json, twins/README.md).
- At the base: `packages/cli/src/main.ts` (the usage lines, `valueFlags`, `givenTwice`, `usageOf`).

## What changes, and why

| First draft | Here | Why |
|---|---|---|
| A form names its line by the line's start; `lineOf` takes the first usage line that starts so | `lineFor(lines, args)` in `helpers.ts`: of the lines whose command word is the form's first word, those that show the form's second word as a literal word when some such line does (`land [judge]`, `hub run \| start \| status`, `rules sync \| reach \| credit`), then those that show every flag the form gives; of these the one with the fewest flags the form doesn't give (`deep status [--json]` before `deep status <session> --why [--json]`, `deep work "<scope>"` before `deep work --repo … --once`) | A rename moves a line's start but not the words a form types. At the base `lineFor` picks the same line as the first draft's `lineOf` for each of the 42 forms (checked by script over the base's `deep --help`) |
| A form whose line start `deep --help` doesn't show fails the table BLOCKED | Such a form is skipped | The criterion is about the commands `deep --help` lists. Completeness is held by the other BLOCKED check, kept: every flag shown once that takes a value, on every listed line, must be given by a form whose line is that line, or the table fails BLOCKED. A form for a command no longer listed tests nothing the criterion names. The one form this skips under #1814 is `deep session rules <session> --json`, whose line shows no value flag, so it had no rows |
| A usage line is a line `deep <word>…` after an optional `Usage:` | The same, after an optional `Usage:` and an optional mark: a run of characters with no letter, digit, `<`, `[` or `-`, before `deep`; and inside the synopsis, any token made only of characters other than letters, digits, `<`, `>`, `[`, `]`, `\|`, `.` and `-` is dropped before the flags are read | #1814 marks "Commands that ask for Touch ID or your password". A mark before `deep` would make the first draft skip the line, silently dropping its rows (`deep hub use --root`, `deep person invite --address` are such commands); a mark after the synopsis could be read as a flag's value |

The forms (`forms` in `../3461/helpers.ts`), the world, `deep`, `help`, `flagsOf`, `valuesIn`, `withRepeat`, `another`,
`commandWords`, `printsUsageOf` and `normalized` are the frozen suite's, imported unchanged. The test body is the first
draft's, with `lineFor` for `lineOf`; its assertions, its row count floor (more than 40), its line count floor (more than
30) and its failure messages are unchanged. `table.test.ts` carries the same tag, `#3461.b4a5c8f4`, and the test name
ends "(redraft 1814)".

## How the criterion is read (unchanged from the first draft)

"Every command `deep --help` lists": each usage line `deep --help` prints. "Each flag its usage shows once": each flag
on that line that takes a value and isn't shown repeating (`...`). "Twice: with two values, and with one value
repeated": the form, given the flag once, must not exit 2 (else BLOCKED: its repeats would prove nothing); then the flag
appended again with another value, and with the same value. "Prints that command's usage and exits 2, with nothing on
stdout": exit 2, stdout empty, a line starting `Usage:` that names `deep <command>`. "Naming the command and the flag":
each failure line reads `deep <command> <flag> (two values | one value repeated): …`.

## How the table was shown to fail

Two twins, the frozen suite's own (`twins.json`, `twins/README.md`): `first-wins-reader` and `last-wins-reader`, the
two planted readers the criterion names, kept as their wrong lines in `packages/cli/src/main.ts`.

Each was run here as a plant on the base's built CLI without changing any file: a scratch copy of this folder's
`table.test.ts`, byte for byte, in a `plant-check/` folder (removed after), whose `helpers.ts` re-exported `./helpers.ts`
except `deep`, which ran the CLI through a front end that registers a Node load hook replacing the twin's line in
`packages/cli/dist/main.js` as it loads. Results (`BASE-RESULTS.txt`):

1. Front end, no plant: passes (the front end alone changes nothing).
2. `first-wins-reader`: fails, "88 of 88 rows (commands and flags) took a repeated flag", each line naming the command
   and the flag.
3. `last-wins-reader`: fails, "86 of 88 rows".
4. A `deep --help` shaped as #1814's Scope says (the base's help with `deep session rules` renamed `deep rules session`,
   `deep inbox undo` and `deep memory overrule` removed, and marks before `deep install` and `deep hub use` and after
   `deep install` and `deep person revoke`), given by the shim's `help`: passes, with the same 88 rows. The first draft's
   reading of that text is BLOCKED (`deep session rules` found nowhere) and skips the two lines marked in front.
5. That help with `last-wins-reader`: fails, "86 of 88 rows", among them `deep hub use --root` and `deep person invite
   --address`, read past their marks.

## On the base

`BASE-RESULTS.txt`: at `9bbe0f24c`, 1 test, passed, 7 s, 88 rows. #3461 is in the base (`givenTwice` in `main.ts`), so
the table passes there; its twins are its proof of failing. The frozen `table.test.ts` also passes at the base (check
6); it would be BLOCKED under #1814.

## What #1814's implementation must keep for this test to pass

- Every usage line in `deep --help` begins `deep <command word>` after its indent, optionally after `Usage:` and a mark
  made of non-letter characters. A mark written in letters before `deep` (for example `(Touch ID) deep …`) would hide
  the line from this table.
- `deep rules session` shows no flag that takes a value, as `deep session rules` didn't; any listed line that gains a
  value flag the frozen forms don't give makes the table BLOCKED (adding flags is outside #1814's Scope).
- The listed lines keep the leading words the frozen forms type (`hub status`, `land judge`, `rules reach`, `start
  approve`, `workspace task`, …); a listed command they don't fit leaves its flags without a form, BLOCKED.
- A repeated flag shown once still prints that command's usage and exits 2 with nothing on stdout.
- For the twins to apply: `packages/cli/src/main.ts` keeps the line `} else if (givenTwice(args) !== undefined) {` once.
- Nothing here needs `deep session rules` to keep dispatching: an unlisted command isn't in the table.

## Open questions

1. **A form for a command no longer listed is skipped, not BLOCKED.** If a wrong program dropped a listed line with a
   value flag from `deep --help`, its flag's rows would be gone; the criterion speaks only of what `deep --help` lists, and
   `lines.length > 30` and `table.length > 40` stay as the first draft set them.
2. **Marks.** Read as non-letter characters, as the Scope's "marked … one line at the foot says what the mark means"
   suggests. A mark in words is not foreseen.

## Run it

macOS or Linux, Node 24, the workspaces built (`npm ci`, `npm run build --workspaces`):

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3461-redraft-1814 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/3461-redraft-1814/tsconfig.json --noEmit
rm -rf tests/acceptance/3461-redraft-1814/node_modules   # vitest's cache, from --root
```

No port, no screen, no hub, no network. It imports `tests/acceptance/3461/helpers.ts` and its world unchanged. Ran on
macOS darwin-arm64 only.

## At merge

This folder's `table.test.ts` carries the same tag as `tests/acceptance/3461/table.test.ts` and replaces it once the
owner approves the swap; until then the frozen file stands unchanged.

## Files

`REDRAFT.md`, `table.test.ts`, `helpers.ts`, `tsconfig.json` (the frozen suite's), `twins.json`, `twins/README.md`,
`twins/first-wins-reader/lines.json`, `twins/last-wins-reader/lines.json` (both the frozen suite's), `BASE-RESULTS.txt`.
