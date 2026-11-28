# Acceptance tests for #1814: deep --help shows a newcomer five commands, and one idea has one command

Written blind, by a job that read only the issue, the design and the base commit; it never saw the implementing work.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). The code files carry no comments (the comment ratchet starts a new blind suite at zero); what
they do is said here.

Base: `9bbe0f24c` (main, 2026-11-27). The issue has seven checkbox criteria, AC1 to AC7 in the body's order. Each
test's name carries its criterion's ID (`#1814.` and the first 8 hex digits of SHA-256 of the criterion's text, white
space collapsed, as `scripts/proof-change.mjs` reads it; checked against the issue's live body):

| AC | ID | File | Tests |
|---|---|---|---|
| AC1 | `#1814.45eb7060` | `start-here.test.ts` | the first group's five lines; a planted sixth line fails the same check, naming it |
| AC2 | `#1814.6dca6b93` | `confirms.test.ts` | "once the OS confirms you" at most once in `deep --help` |
| AC3 | `#1814.93b182f5` | `undo.test.ts` | `deep undo <ask>` appends the events `deep inbox undo <ask>` appends |
| AC4 | `#1814.eb65b1b5` | `guard-entries.test.ts` | `deep guard add` and `deep setup` output; a planted "your rules" fails the lint, naming the file |
| AC5 | `#1814.df823cc0` | `waiter.test.ts` | `deep waiter` with no plant set |
| AC6 | `#1814.593c3f14` | `count.test.ts` | the count's check passes and is in the lint lane; a planted top-level command fails it, naming it |
| AC7 | `#1814.e1bf7588` | `design-row.test.ts` | the design's command row against `deep --help`'s first two groups; a planted row fails, naming the command |

## What was read

- Issue #1814's body (Scope, the seven criteria, Proof, Depends on). The linked issues were not needed.
- `AGENTS.md`; `docs/technical-design.md`: the CLI row of the components table (line 107), the command row of "The
  other interfaces" (`| CLI | ...`, line 515 at the base), Dogfooding, Wrong programs, Built to be hard to get wrong.
- At the base, for surfaces only: `packages/cli/src/main.ts` (the usage table, `groups`, the dispatch, `deep waiter`),
  `packages/hub/src/undo.ts`, `guards.ts` (`deep guard add`), `setup.ts` (`waiterCommand`), `plant.ts`;
  `scripts/lanes.mjs` (the lint lane, `lane.json`), `scripts/proof-change.mjs`, `scripts/glossary-lint.mjs`. Suites, for
  their conventions and reused by import (acceptance files are never edited, so these imports don't move): `1812`
  (worlds, `deep`, setup through the CLI, the scratch checkout for a lint's `--root`), `1856` (a hub with the defaults
  and `deep guard add`), `1810` (a record with an ask taken by its default, through `16` and `26`).

## Run them

macOS, with the repo's Node (24.22.0):

```sh
npm ci
npm run build --workspaces
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1814 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1814/tsconfig.json --noEmit
```

The files start hubs and run deep-hook from `target/`, so `lane.json` runs the folder alone (`binary`). A missing
build, a hub or setup that doesn't start, or a plant that couldn't be laid throws BLOCKED, never a pass. Throwaway
worlds live under `/tmp/dh1812-*`, `/tmp/dh1856-*`, `/tmp/dh1810-*`-style folders of the reused helpers, and the
scratch checkouts under `/tmp/dh1814-*`; all are removed at the end. Processes are stopped by PID only.

## The seam the implementation provides

- **The lint: `node scripts/command-lint.mjs [--root <checkout>]`**, run by the lint lane (`scripts/lanes.mjs`,
  `checks`, name `lint`, a command ending in `scripts/command-lint.mjs`). It reads the checkout `--root` names (this
  one when left out); the tests run the copy's own script with `--root` set to the copy and the copy as the working
  folder, so reading either is fine. It prints each finding on a line starting `FAIL` that names what it found, and
  exits 1 when there is one, 0 when there is none. It holds three things:
  1. **The count (AC6):** every top-level word of the usage table has an entry in the count's list (the list and its
     form are the implementation's; the scope says each new word names the issue that says why no existing command
     can hold it). A word with no entry fails, its FAIL line naming the word.
  2. **The design's command row (AC7):** the row in `docs/technical-design.md` that starts `| CLI |` names exactly the
     commands of the usage table's first two groups. A word in the row that is no command fails, naming the word.
  3. **Guard entries' wording (AC4):** a person-facing "rules" for guard entries, in the files that print `deep guard
     add`'s and `deep setup`'s words, fails, its FAIL line naming the file.
- **No other seam.** AC1's wrong program is a front end in test code (`fixtures/sixth-line.mjs`), and AC5 runs with
  every `DEEP_` variable removed, so no plant is set.

## The plants

Each plant is laid in a scratch copy of this checkout (`helpers.ts`, `scratchCheckout`: every top-level entry but
`.git`, `node_modules`, `target`, `tests`, `crates`, `vendor`, `spikes`, `reports` and `benchmarks`, and `docs` without
`evidence`, `images` and `spikes`, cloned; `node_modules` a folder of links, as #1812's copy). Before the plant, the
lint must pass on the same copy (an assertion, so a lint that fails everything proves nothing); after it, the lint must
print a FAIL line naming the plant and exit 1.

- **AC1, a sixth line:** `fixtures/sixth-line.mjs` runs the built CLI in its own process and adds
  `  deep update --check   whether a newer DeepBuild is out` (the line the scope moves out) at the end of the first
  group of what it prints. The same check that holds the real `deep --help` (`startHereFailures`) must fail on it with
  a finding naming `deep update --check`; before that, the check must pass on the real `deep --help`.
- **AC4, "your rules":** appended to the copy's `packages/hub/src/guards.ts` (the file that holds `deep guard add`):
  ``export const dh1814Added = (names: readonly string[]): string => `Added ${names.join(', ')} to your rules`;``,
  the merge base's own words for what `deep guard add` added. The FAIL line must name `packages/hub/src/guards.ts`.
- **AC6, a new top-level command:** in every `.ts`, `.js` or `.mjs` file under the copy's `packages/cli/src` and
  `packages/cli/dist` with a line that holds `'deep backup <folder>` and ends in `',` (the usage table's line, in source
  and built), a line after it: `'deep sweep   tidies nothing, a top-level word planted by tests/acceptance/1814',`.
  The FAIL line must name `sweep`. A copy where no file holds that line is BLOCKED: the usage table must keep its
  lines as single-quoted strings, one a line, with `deep backup <folder>` among them.
- **AC7, a row naming a command that doesn't exist:** ` · sweep` added at the end of the command row's second cell
  (inside its closing backtick). The FAIL line must name `sweep`.

## How each criterion is read

1. **The first group** is the first block of `deep --help` that starts with a title line (`Start here:`) and lists
   usage lines (indented, starting `deep `, after an optional mark of up to three characters). It must be titled
   `Start here` and list exactly five lines: `deep status`, `deep inbox` and `deep doctor` with no word after them but
   flags, placeholders or the description; `deep off | on`; and `deep setup` with `--undo` and no subcommand. A line
   that is none of them, or a second line for one, is named.
2. **At most once** counts stdout and stderr together. `deep --help` must exit 0 and list at least two groups, so an
   empty help doesn't pass.
3. **"Does what `deep inbox undo` does, by the record's events":** two worlds, each built as #1810's fixture builds one
   (a session's first turn through a real hub, then an ask taken by its default through the record and asks core,
   then a real hub again with `DEEP_HUB_TEST_CONFIRM` answering `confirmed`). In one, `deep inbox undo <ask>`; in the
   other, `deep undo <ask>`. The events each appends after the record settles are compared in order by kind, writer,
   actor, scope and data, with the ask's handle, the session ID, ULIDs, ISO times and millisecond times read as
   placeholders. `deep inbox undo` must exit 0 and append something, or the test is BLOCKED; `deep undo` must exit 0.
4. **"Print 'guard entries' and never 'rules' for them":** `deep guard add` of one entry with its planted call and twin
   against a running hub with the defaults installed (#1856's world), and `deep setup` in an empty home with the login
   service stand-in (#1812's world). Each one's output (stdout and stderr) must hold "guard entries" (or "guard entry")
   and no line with the word "rule" or "rules", the file name `rules.json` aside. Read strictly: these two commands
   print nothing about the rules you wrote.
5. **"Exits 2 as an unknown word":** in an empty home with no `DEEP_` variable, `deep waiter` exits 2, prints nothing
   on stdout, says on stderr what an unknown word (`zqxjvk`) says with the word swapped (a "Did you mean" clause
   aside), and creates no `~/.deepbuild`.
6. **"Fails the lint lane, naming it":** the lint lane's count check, as above; it must also pass over this checkout.
7. **"Equals the usage table's first two groups":** compared as top-level words. The row's words are its second cell's
   `·`-separated items, each item's first word (`off\|on` gives `off` and `on`); the table's are each usage line's
   first word and its `|` alternatives (`deep off | on`). Subcommands (`person invite\|revoke`) aren't compared.

## Not covered

- `install`, `memory`, `secret` and `update` moving to "Your work", the Touch ID mark and its foot line, `deep rules
  session` and the old form for one release, `deep undo` on a staged change, a sync and a decision, `deep memory
  overrule` as another name, and `deep waiter` running under the test plant: scope items no criterion names.
- AC1's plant fails the test's own check, not the lint lane (the Proof's "each plant failing in the lint lane"): a
  blind job can't plant a sixth Start-here line in source whose shape it hasn't seen.
