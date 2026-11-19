# #1359 AC9 blind redraft, after #1812: `help` asks only in `deep help`, a later `help` is an argument, and `deep --help` ends on an exit table

#1359's AC9 (`#1359.f0bb482f`) says "`-h`, `--help` or `help` anywhere in a command's arguments prints that command's
usage, exits 0 and runs nothing first. In a fresh home, `deep status --help` and `deep inbox -h` leave the home
byte-identical; on the merge base setup runs, and the test fails, naming the first file written". Its file,
`tests/acceptance/1359/help-acts-nothing.test.ts`, holds it through ten "anywhere" cases, four of them with the word
`help` after a command's name, and a table of every command `deep --help` lists.

#1812's Scope narrows the word: "`help` asks for help only as the first argument after the command. `-h` and `--help`
stay as they are", and with its fourth criterion, "`deep find help` searches for the word", that place is `deep help`
(Readings, 1). A `help` after a command's name is then one of its arguments, and "A listed command with arguments that
fit none of its forms prints that command's usage and exits 2, as `deep status x` does today". Its Scope and design line
also print the exit table at the foot of `deep --help`, ending on a sentence for `deep lease` and `deep mcp-exec`, which
#1359's reading of that text would take for a command. This redraft keeps every assertion #1812 doesn't change, and
changes the four `help` cases (holding the word itself in `deep help`) and the table's reading, and nothing else. It is
the only file of the suite #1812 changes.

Written from issue #1359 (closed) and issue #1812 (open), each read live; #1812's blind suite at the base; the design;
and the frozen suite. I never read an implementation of #1812, any commit after the base, branch, pull request, other
worktree or uncommitted change.

## What was read

- Issue #1359, `gh issue view 1359 --repo windoliver/deepbuild --comments`: the eleven items, the eleven criteria,
  Proof, and the owner's comment reproducing items 9 and 10. Its criterion IDs, computed from the live body as
  `scripts/proof-change.mjs` does, match the frozen README's table (AC9 `#1359.f0bb482f`).
- Issue #1812, the same way: its body (Scope, the eight criteria, Proof, Depends on) and the owner's two comments (the
  Nov 9 tracker review, and the Nov 10 audit's numbers).
- #1812's blind suite at the base, `tests/acceptance/1812/`: README.md (above all Surfaces pinned here, Choices and Not
  covered), helpers.ts, every test file, `fixtures/help-anywhere.mjs`, BASE-FAILURE.txt. Tests, not an implementation.
- `docs/technical-design.md` at the base: the deep CLI row under "One hub per user, a tiny hook client, and extensions
  in-process" (with #1812's line, commit 014919052), States people see, Dogfooding. `AGENTS.md`.
- The frozen `tests/acceptance/1359/`: README.md, helpers.ts, every test file, its fixtures, BASE-FAILURE.txt,
  tsconfig.json. None was edited.
- For form: `tests/acceptance/19-redraft-2073/REDRAFT.md` (and its BASE-RESULTS.txt, tsconfig.json),
  `tests/acceptance/556-redraft-ac5/README.md`; for a file whose tests only partly change, parts of
  `724-redraft-1405/REDRAFT.md`, `326-redraft-2073/REDRAFT.md` and `313-redraft-2560/REDRAFT.md`.
- At the base, only for how the surfaces are driven: `packages/cli/src/main.ts` (the usage lines, the help check, the
  first-run list, `unsupported()`), and the argument checks of `packages/hub/src/list.ts` (status), `inbox.ts`,
  `install.ts` and `memory.ts`; `setup.ts` (its exits and the wiki step); `scripts/lanes.mjs` (its lists),
  `scripts/proof-change.mjs` (criterion IDs), `scripts/throttle.mjs` and `scripts/lease`.

## What #1812 changes, test by test

All rows are AC9, `#1359.f0bb482f`, in `tests/acceptance/1359/help-acts-nothing.test.ts` (names shortened to the part
after the ID). "Replaced by" names this folder's `help-acts-nothing.test.ts`.

| Original test | Why the old expectation no longer holds under #1812 | Replaced by |
|---|---|---|
| `deep status help runs nothing first, prints its usage and exits 0` | "`help` asks for help only as the first argument after the command" (Scope), which is `deep help` alone (Readings, 1), so `help` is status's argument. Status's arguments then fit none of its forms (Readings, 2), and "A listed command with arguments that fit none of its forms prints that command's usage and exits 2, as `deep status x` does today" (Scope). Exit 0 no longer holds. | `deep status help prints status's usage, exits 2 and runs nothing, help being status's argument (redraft 1812)`, in a home where setup finished (Readings, 3). Kept: nothing written in the home or the working folder, no call to the login service or a service manager (read through the exit table's "2 not understood, nothing ran"). Changed: exit 2. The usage is read through #1812's surface: a line that starts `Usage:` and names `deep status`, on stdout or stderr, and no "Unsupported command" ("'Unsupported command' is for a word that isn't a command", Scope; #1812's suite, Surfaces 2) (Readings, 6). |
| `deep inbox answer a1 help runs nothing first, prints its usage and exits 0` | `help` last, after a value, no longer asks for help (Scope). `inbox answer a1 help` fits `deep inbox answer <ask> <option>`: an answer `help` to the ask `a1`, which goes to the hub, not a help request (Readings, 4). | `deep inbox answer a1 --help runs nothing first, prints its usage and exits 0 (redraft 1812)`: the same place, last after a value, asked with `--help`, which #1812 keeps as it is. Every assertion kept. No other case puts a help word after a value. |
| `deep install help runs nothing first, prints its usage and exits 0` | `help` is install's package folder: `deep install help` fits `deep install [--trust-key] <package folder>` and reads `./help/deepbuild.json` (Readings, 4). | No case of its own. The table's `deep install --help` holds the same command with a help word in the same place, under the same four assertions; the word `help` is held by `deep help`, below. |
| `deep memory keep help runs nothing first, prints its usage and exits 0` | `help` is the lesson to keep: it fits `deep memory keep <lesson>` and goes to the hub (Readings, 4). | No case of its own: the table's `deep memory keep --help`, and `deep help`. |
| (the word `help` in AC9) | The four cases above were the file's only `help` words. Under #1812 the word asks for help in one place. | `deep help runs nothing first, prints its usage and exits 0 (redraft 1812)`: in an empty home, nothing written, no call, exit 0, stdout names `deep` (Readings, 7). |
| `every command deep --help lists, with --help after it, runs nothing, prints its usage and exits 0` | "The exit table is printed at the foot of `deep --help`" (Scope), and the design line ends it "`deep lease` and `deep mcp-exec` end with the code of the program they run". #1359's `listedCommands` takes every line `deep <lowercase words>` for a usage line, so that sentence reads as a twelve-word command; `deep lease ... --help` prints deep lease's usage, which can't name its words, and the table fails on a correct program (Readings, 5). | The same name with "(redraft 1812)": the same table and assertions, its commands read as #1812's suite reads them (`helpers.ts`): a line whose leading words run past two is prose, not a usage line. |

## Kept as they are

- In `help-acts-nothing.test.ts`, carried into this folder's file with their names and assertions unchanged: the first
  test (`deep status --help` and `deep inbox -h` leave the home byte-identical...) and six of the ten "anywhere" cases,
  `inbox -h answer`, `off --help`, `on -h`, `env up --help`, `guard add -h` and `memory --help --json`. Each asks with
  `-h` or `--help`, which "stay as they are", in first, middle or last place.
- `help-words.test.ts` (AC4): `help` asks for help in `deep help`, `-h` stays, and the design line keeps "`deep help`
  and `deep -h` print what `deep --help` prints and exit 0". The exit table is printed by all three alike.
- `help-table.test.ts` (AC10): it asks with `--help` and `-h` only. Its table reads #1359's `listedCommands`, and a
  prose line read as a command there still prints deep lease's usage, writing and opening nothing, so its outcome
  doesn't change. Its plant is `deep backup`'s.
- `unknown-command.test.ts` (AC11): `stauts` and `xyzzy` aren't commands, and "'Unsupported command' is for a word that
  isn't a command". It reads only the commands' first words; a prose line's, `lease`, is a command already.
- `old-node.test.ts` (AC6): under an older Node every command, and a prose line read as one, exits 2 before anything is
  read. #1812's table reads 2 as "not understood, nothing ran".
- `doctor-fix.test.ts` (AC1): `deep doctor --json`'s `hub.socket` fix names `deep setup` in a home nobody set up and
  `deep hub start` once set up, the same fixes #1812's sentence names. `deep doctor` is outside #1812's table, and this
  test reads the JSON with `--json`.
- `lasting-node`, `setup-lines`, `status-empty`, `no-cargo` and `readme` (AC2, AC3, AC5, AC7, AC8): #1812 changes
  nothing they read. Setup exits 4 at the base when the wiki wasn't built, which #1812 moves to 3 ("A setup whose wiki
  wasn't read ... exit 3"); a setup whose wiki is built still exits 0, as #1812's own suite requires of setup. AC7 reads
  only a non-zero exit.

## Readings where #1812 leaves room

1. **"The first argument after the command" is `deep help`.** The Scope gives `help` one place; the fourth criterion
   has `deep find help` search, though `help` is the first argument after `find` there. Both hold only if the command
   is `deep` itself, so `help` asks for help in `deep help` and in no argument after a command's name. This is also the
   reading this job was handed. #1812's suite holds only `deep find help` and leaves `deep <command> help` elsewhere to
   the implementation (its Choices, 10). Read as the first argument after a command's name with `find` excepted,
   `deep status help` would still be a help, exit 0, and the `status help` test here would fail that program; the other
   redrafted tests hold under both readings.
2. **`help` fits none of status's forms.** Status's forms are `deep status [--json]` and `deep status <session> --why
   [--json]`; a lone word without `--why` fits neither, as `x` doesn't. At the base `deep status x`, in a home where
   setup finished, printed `Usage: deep status [--json] | deep status <session> --why [--json]` on stderr, exited 2,
   and wrote and called nothing (a scratch run, BASE-RESULTS.txt).
3. **A home where setup finished, for `deep status help`.** Status is a first-run command: in a home nobody set up, the
   base sets the home up before it reads status's arguments unless help was asked (#1002; `main.ts`). Once `help` is an
   argument, what a first-run command does there before it reads its arguments is outside #1812: #1812's suite runs its
   own unfit-argument case, `deep off now`, in a home holding #1002's `setup-finished.json`, as "#2200's ground, not
   this issue's" (its AC3), and the owner's second comment on #1812, of a home that was never set up, says "The
   commands in the first-run list set the home up instead, which #2200 covers". So this test writes that marker as
   #1812's suite does (`helpers.ts: finished`). "Runs nothing first" is read as #1359 reads it, nothing written in the
   home or the working folder and no call to a service manager, which the exit table's "2 not understood, nothing
   ran" keeps.
4. **A `help` that fits a form is the command's own work.** As `main.ts`, `inbox.ts`, `install.ts` and `memory.ts`
   read arguments at the base, `inbox answer a1 help`, `install help` and `memory keep help` each fit a form of their
   command, so #1812's usage rule doesn't reach them and #1359's criterion no longer speaks to them. Whether a later
   implementation checks a handle's shape is its own; none of these is redrafted to a usage. The places they held stay
   held with the flags #1812 keeps.
5. **The commands `deep --help` lists, past the exit table.** At the base both readings list the same 75. With a foot
   like the design line's, the frozen reading adds `lease and deep mcp-exec end with the code of the program they`, and
   this one adds nothing (BASE-RESULTS.txt, scratch 2 and 3). #1812's suite holds its own table to this reading (a listed
   command it neither runs nor leaves out by name is BLOCKED), so a program that passes it prints no foot this reading
   takes for a command. Of the frozen files that read the list, only AC9's table depends on it.
6. **The usage, through #1812's rule.** #1359 read a help's usage on stdout, naming `deep` and the command. For
   arguments that fit no form the stream is #1812's (stderr for `deep status x` at the base), so both streams are read,
   for a line that starts `Usage:` and names the command, as #1812's suite reads its own three ("every command's usage
   line starts `Usage:`", Scope).
7. **`deep help` under AC9.** Its command is `deep` itself, so its usage is read as #1359 reads one: stdout names
   `deep`, with no further words. That it prints exactly what `deep --help` prints is AC4's, kept.

## Wrong programs they fail

- A `deep` that still reads `help` anywhere as a help, the base: `deep status help` fails at the exit, 0 for 2
  (BASE-RESULTS.txt).
- A `deep` that answers a listed command's stray argument "Unsupported command": `deep status help` fails at the usage
  line. One that drops the word and lists, asking the hub: fails at the exit (3 with no hub). Both were run on a
  scratch stand-in (BASE-RESULTS.txt, scratch 3).
- A `deep` that sets the home up, or acts, before it honours `--help` after a value, as #1359's merge base dd83ac2f did
  for every first-run command: `deep inbox answer a1 --help` fails at "wrote in a home nobody set up", as the frozen
  `inbox answer a1 help` failed there (the frozen BASE-FAILURE.txt). Not run here; see Found on the way.
- A `deep help` that isn't a help, as at 3d30b4ef ("Unsupported command", exit 2, the frozen BASE-FAILURE.txt's run 2):
  fails at the exit. Not run here.
- The table: any listed command that acts on `--help`, as at #1359's merge base.

A program that behaves as #1812 says, a scratch stand-in of it on the base's CLI, passes all twelve tests
(BASE-RESULTS.txt, scratch 3).

## On the base

`BASE-RESULTS.txt` holds the run at `c0a9de979` on November 18, 2026: 12 tests, 1 failed, 11 passed, 9.2 s.

- `deep status help ... (redraft 1812)` FAILS at the exit check #1812 changes: exit 0, status's usage on stdout,
  nothing written, nothing called. The base reads `help` anywhere.
- The other three redrafted tests pass: #1812 changes their inputs, not their expectations, and the base already
  honours `--help` anywhere and `deep help`, with no exit table under `deep --help` yet. The eight carried tests pass.
- None failed before its assertion: no load error, typo or fixture.
- deep-hook: none of these tests runs setup or a hub (`setUp` and `needHook` are never called), so none needs it. Its
  build was queued behind this Mac's build throttle when the run started; the report says whether it was built.
- Never run: an implementation of #1812 (none exists here). A stand-in on the base's CLI stood in for it.

## Found on the way

- #1359's world lets `deep setup` fetch Claude Code's installer over the network since #1349, as #1812's README found:
  it sets neither `DEEP_HUB_TEST_INSTALLER` nor an agent stand-in. This redraft imports that world unchanged, since it
  isn't #1812's to change. None of its tests runs setup on the base or on a program that honours help, but a wrong
  program that sets a home up on a help request would fetch it, so no such program was run here. A follow-up for the
  frozen suite's world, beside the one #1812's README names.

## Run it

macOS, with the repo's Node first on PATH and the workspaces built (`npm ci`, `npm run build --workspaces`):

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1359-redraft-1812 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1359-redraft-1812/tsconfig.json
rm -rf tests/acceptance/1359-redraft-1812/node_modules   # vitest's cache, from --root
```

About 10 s on this Mac at a load near 500. It imports `tests/acceptance/1359/helpers.ts` and its fixtures unchanged;
`helpers.ts` here holds only `listedCommands` (#1812's suite's reading) and `finished` (#1812's suite's marker).
`DEEP1359_CHECKOUT` works as in the frozen suite.

## At merge

This folder's `help-acts-nothing.test.ts` replaces `tests/acceptance/1359/help-acts-nothing.test.ts` whole. Until the
owner approves the swap, the frozen file stands, unchanged, beside it. The redrafted tests carry the same tag,
`#1359.f0bb482f`. `tests/acceptance/1359/` is on none of `scripts/lanes.mjs`'s lists, so neither is this folder, and
`scripts/lanes.mjs` is unchanged.

## Files

`REDRAFT.md`, `BASE-RESULTS.txt`, `help-acts-nothing.test.ts`, `helpers.ts` and `tsconfig.json` (the frozen suite's).
