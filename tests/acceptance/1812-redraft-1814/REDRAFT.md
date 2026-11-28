# #1812 criteria e264e123 and 5a83f2e0, blind redraft after #1814: the hub-down tables hold `deep host add` and `deep rules session`, and read a marked usage line

#1812's first two criteria:

- `#1812.e264e123`: "A table test runs every command `deep --help` lists against a home with no hub. Each prints the one
  sentence with its fix and exits 3, and none prints an errno or a path twice. On the merge base `deep inbox` prints a
  raw socket error, and the test fails, naming the command".
- `#1812.5a83f2e0`: "The same table in a home that isn't set up names `deep setup` as the fix, never `deep hub start`".

The first draft, `tests/acceptance/1812/hub-down.test.ts` and `not-set-up.test.ts` with `helpers.ts`, fails both tables
BLOCKED when `deep --help` lists a command they neither run nor leave out by name. At this base they are already BLOCKED
for `deep host add`, which #1812's merge base didn't list. #1814's Scope adds another: "`deep session rules` becomes
`deep rules session`". It also unlists `deep inbox undo` and `deep memory overrule`, marks the commands that ask for
Touch ID or a password, and regroups the list. This redraft keeps both criteria, the table, its left-out list and every
assertion, and adds the two commands and a reading of a marked line.

Written by a fresh run of the blind acceptance job, from issues #1812 and #1814, the design, `AGENTS.md`, the base
commit and the frozen first draft. I never read an implementation of #1814, a pull request, a branch, another worktree,
a diff or any commit but the base.

## What was read

- Base: `9bbe0f24c` (the merge of #3764), read 2026-11-28. Its sources with `git show 9bbe0f24c:<path>`; its built CLI
  run as `node packages/cli/dist/main.js`; `target/debug/deep-hook` built.
- Issue #1812 (`gh issue view 1812`): body, Scope, the eight criteria; the tags, `sha256` of each criterion's text after
  `- [ ] ` with white space collapsed, begin `e264e123` and `5a83f2e0`.
- Issue #1814: body, Scope, the seven criteria.
- `AGENTS.md`; `docs/technical-design.md`'s Dogfooding part.
- The frozen first draft, read only: `tests/acceptance/1812/README.md` (The table, The plants), `helpers.ts`,
  `hub-down.test.ts`, `not-set-up.test.ts`, `tsconfig.json`.
- For form: `tests/acceptance/1359-redraft-1812/REDRAFT.md`, `tests/acceptance/3461-redraft-once/` (REDRAFT.md,
  BASE-RESULTS.txt, twins.json, twins/README.md).
- At the base: `packages/cli/src/main.ts` (the usage lines and dispatch), `packages/hub/src/hosts.ts` (`hostCommand`),
  `packages/hub/src/client.ts` (`notAnswering`, `failure`, `notAnswered`), `packages/hub/src/inbox.ts` and
  `packages/hub/src/list.ts` (the hub-down paths of `deep inbox` and `deep status`).

## `deep host add`, from the base's own help and code

The base's `deep --help` lists it on the `deep host` line, under "Your work": "`… | add <host>` … or install deep-hook
and the agents' hooks on one, so its sessions record here under its name". In `hosts.ts`, `hostCommand` takes `add <host>`
and its first act is `hub('host.add', { host })`: a call on the hub's socket with the control token, whose failure goes to
`notAnswered`, the one sentence and exit 3. It calls the hub, so the criterion's words ("every command `deep --help`
lists", run "against a home with no hub") make it a row, not a command left out: `host add h1`, as the table's other
`host` rows name `h1`. `host` is not in the first-run list, so it is a row of both tables. At the base it prints the one
sentence with `deep hub start` in a set-up home whose hub was stopped, and with `deep setup` in a home nobody set up,
and exits 3 in both (the base run passes); with the socket error planted it fails, naming `deep host add` (check 2), so
the row reaches the hub.

## What changes, and why

| First draft | Here | Why |
|---|---|---|
| `hubForms` has no `host add` | `host add` → `['host', 'add', 'h1']` | Above |
| `hubForms` has `session rules` | It keeps it and adds `rules session` → `['rules', 'session', 'session:<id>']` | #1814 lists the command as `deep rules session`; the table runs whichever name `deep --help` lists. `session rules` stays for the base, which lists it |
| `listedCommands` reads a line `deep …` after an optional `Usage:` | The same reading, also after a mark before `deep` (a run of characters with no letter, digit, `<`, `[` or `-`), and with any synopsis token made only of characters other than letters, digits, `<`, `>`, `[`, `]`, `\|`, `.` and `-` dropped before the words are read | #1814 marks the commands that ask for Touch ID or a password. A mark before `deep` would drop the line from the first draft's table silently (no BLOCKED: it is never listed), and the marked commands are many of the table's rows (`off`, `on`, `inbox answer`, `install`, `guard add`, `hub use`, …). A mark after a one-word command with nothing after it (`off * \| on *`) would read `on` as `off on` |
| `deep inbox undo`, `deep memory overrule` rows | Kept in the forms | They run only while `deep --help` lists them (the table is built from the listing). Under #1814 they are unlisted and leave the table; `deep undo`, still listed, keeps its row |

The left-out list (`NEEDS_NO_HUB`), the first-run list (`FIRST_RUN`), the world, `setUp`, `stopHubs`, `answers`,
`deep`, `help` and `hubDownFailures` are the frozen suite's, imported unchanged. `table()` is the frozen one with the
forms and the reading above; it still fails BLOCKED for a listed command it neither runs nor leaves out, and when `deep
inbox` isn't listed. The two test files are the frozen ones with the same tags and assertions; their names end
"(redraft 1814)".

## How the tables were shown to fail

Three twins (`twins.json`, `twins/README.md`), kept as wrong lines, each laid on the base's `packages/hub/src` passing
`tsc` under the repo's settings:

- `#1812.e264e123`: `inbox-raw-socket-error`, the wrong program the criterion names: `deep inbox` with the hub down
  prints `can't reach the hub at <socket>: connect ENOENT <socket>` (the socket error's own words) instead of its
  database's list under the sentence; and `raw-socket-error`, the same for every command that reports through the one
  function (`failure()` in `client.ts`).
- `#1812.5a83f2e0`: `hub-start-fix`, a home nobody set up told `deep hub start`.

Each was run here as a plant on the base's build without changing any file: scratch copies of the two test files, byte
for byte, in a `plant-check/` folder (removed after), whose `helpers.ts` re-exported `./helpers.ts` with `deep` handing
the frozen `deep` a front end (its `cli` option) that registers a Node load hook replacing the twin's line in
`packages/hub/dist/inbox.js` or `client.js` as it loads. Results (`BASE-RESULTS.txt`):

1. Front end, no plant: both pass.
2. `raw-socket-error`: hub-down fails, "55 of the 57 commands …", each naming the command, its errno and the socket path
   printed twice (`deep host add` among them). (Not-set-up fails on one row, `deep hub status`.)
3. `inbox-raw-socket-error`, hub-down only: fails, "1 of the 57 commands …", the line `deep inbox prints no line saying
   the hub isn't answering; deep inbox prints an errno, ENOENT; deep inbox prints "…/hub.sock" twice`.
4. `hub-start-fix`: not-set-up fails, "41 of the 41 commands …", each naming the command and `deep hub start`.
5. A `deep --help` shaped as #1814's Scope says (the base's help with `deep session rules` renamed `deep rules session`,
   `deep inbox undo` and `deep memory overrule` removed, and marks before `deep install` and `deep hub use` and after
   `deep install` and `deep person revoke`), the shim's `table` reading it with this folder's `listedCommands` and
   `hubForms`, and `deep rules session …` run as the base's `deep session rules …`, standing in for #1814's rename: both
   pass. The first draft's reading of that text is BLOCKED (`deep rules session`, `deep host add`) and drops `deep
   install` and `deep hub use`.
6. That help with `hub-start-fix`: not-set-up fails, "41 of the 41", `deep rules session` among them.

## On the base

`BASE-RESULTS.txt`: at `9bbe0f24c`, 2 tests, both passed, 24 s; the listing reads 76 commands, hub-down runs 57 rows and
not-set-up 41. The frozen files fail BLOCKED at the base, "deep --help lists deep host add, which this table neither runs
nor leaves out by name" (check 7). #1812 is in the base, so these tables pass there; the twins are their proof of
failing.

## What #1814's implementation must keep for these tests to pass

- `deep rules session session:<id>` calls the hub: in a set-up home whose hub was stopped, it prints the one sentence
  naming `deep hub start` and exits 3; in a home nobody set up, the sentence names `deep setup`, never `deep hub start`,
  and it exits 3. No errno, no path twice.
- `deep host add h1` does the same (it does at the base).
- `deep --help` lists no command name beyond those in the forms or `NEEDS_NO_HUB` (`deep undo` keeps the name `undo`,
  run as `deep undo staged:<id>`); a new name makes both tables BLOCKED.
- Every usage line begins `deep <command words>` after its indent, optionally after `Usage:` and a mark made of
  non-letter characters. A mark in letters before `deep` would hide the line.
- `deep inbox` is still listed, and with its hub down prints the one sentence (from its database list or alone).
- For the twins to apply: `packages/hub/src/client.ts` keeps `  if (!setUp) return "The hub isn't answering; set this
  home up with deep setup.";` and `  return error instanceof Unanswered || tokenless ? notAnswering(socket) : error
  instanceof Error ? error.message : String(error);` once each, and `packages/hub/src/inbox.ts` keeps `    if (!read)
  return notAnswered(error);` once.
- Nothing here needs `deep session rules` to keep dispatching: unlisted, it isn't run.

## Open questions

1. **Unlisted other names.** `deep inbox undo` and `deep memory overrule` leave the table under #1814, since the
   criterion runs what `deep --help` lists. Their hub-down behavior is then held by no row here; `deep undo` with an
   ask's handle (#1814's third criterion) is #1814's own suite's.
2. **Marks.** Read as non-letter characters, as the Scope's "marked … one line at the foot says what the mark means"
   suggests.

## Run it

macOS, Node 24, the workspaces built (`npm ci`, `npm run build --workspaces`) and `target/debug/deep-hook` built
(`cargo build --locked -p deep-hook`):

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1812-redraft-1814 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1812-redraft-1814/tsconfig.json --noEmit
rm -rf tests/acceptance/1812-redraft-1814/node_modules   # vitest's cache, from --root
```

It imports `tests/acceptance/1812/helpers.ts` and its fixtures unchanged. Ran on macOS darwin-arm64 only.

## At merge

This folder's two test files carry the same tags as `tests/acceptance/1812/hub-down.test.ts` and `not-set-up.test.ts`
and replace them once the owner approves the swap; until then the frozen files stand unchanged.

## Files

`REDRAFT.md`, `hub-down.test.ts`, `not-set-up.test.ts`, `helpers.ts`, `tsconfig.json` (the frozen suite's),
`twins.json`, `twins/README.md`, `twins/inbox-raw-socket-error/lines.json`, `twins/raw-socket-error/lines.json`,
`twins/hub-start-fix/lines.json`, `BASE-RESULTS.txt`.
