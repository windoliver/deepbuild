# #2331 criterion 1 blind redraft, after #1812: deep inbox's hub-down line becomes the one sentence with its fix

#2331's first criterion (`#2331.04651a1b`) says "`deep inbox` over an ask with a default constructs no date or number
formatter, counted by a preload that wraps `Intl.DateTimeFormat` and the `toLocale*String` methods". Its file,
`tests/acceptance/2331/inbox.test.ts`, runs `deep inbox` in #1463's world twice: once with the hub up, once with it
down. Besides the count, the hub-down run holds check (c) of the frozen README: "with the hub down, the first line is the
base's `The hub isn't answering, since HH:MM; …` at a minute the hub could have stopped". The test compares stdout's
first line with the exact text `The hub isn't answering, since <HH:MM>; this is the list its database holds.`

#1812's Scope, its first item, replaces that line: "One sentence for a hub that isn't answering, from one function, in
every command: that it isn't answering, since when if the record says, and the one fix, `deep setup` in a home that
isn't set up, else `deep hub start`. No path twice and no errno, and BLOCKED stays a verdict's word". Its first criterion
names `deep inbox` among the commands that print that sentence with its fix and exit 3. A correct #1812 therefore fails
check (c): the exact line names no fix, and #1812's suite lets the sentence go to stderr. The criterion itself still
holds. This redraft keeps the test whole and changes only check (c). The new check reads the line #1812 makes and still
holds what #2331 needs from it: the time the hub stopped answering, written as today's clock writes it.

## What was read

- Issue #2331 (closed): its body, as the frozen suite was written from it. It has no comments. Its third criterion
  moved to #2740 on Nov 16, so the issue now holds two.
- Issue #1812 (open): its body (Scope, the eight criteria, Proof, Depends on) and the owner's two comments of Nov 10.
- #1812's blind suite at the base, `tests/acceptance/1812/`. Tests, not an implementation. I read: README.md (Surfaces
  pinned here, How each criterion is read, The table, and Choices where the issue leaves one open, whose items this
  file calls its readings); `helpers.ts`, its `hubDownFailures` and `SENTENCE`; `hub-down.test.ts`,
  `not-set-up.test.ts` and `hub-start.test.ts`; and the lines of BASE-FAILURE.txt about `deep inbox`.
- The design at the base, `docs/technical-design.md`:
  - the deep CLI row under "One hub per user, a tiny hook client, and extensions in-process", with #1812's added
    sentences (commit 014919052);
  - States people see;
  - Dogfooding.
- The frozen suite `tests/acceptance/2331/`: README.md, `inbox.test.ts`, `kit.ts`, `judges.test.ts`, `week.test.ts`,
  `count-formatters.cjs`, `twins.json`, `tsconfig.json`, and the two twins' `list.ts`, as diffs against the base's.
  There is no BASE-FAILURE file at this base.
- For form: `tests/acceptance/19-redraft-2073/REDRAFT.md` (and its BASE-RESULTS.txt and its test's header and names)
  and `tests/acceptance/556-redraft-ac5/README.md`.
- Base `c0a9de979`, read only for how the surfaces are driven:
  - `packages/hub/src/list.ts`: `clock`, `when`, `hubDown`, `fromDatabase`;
  - `packages/hub/src/inbox.ts`: `inboxCommand`;
  - `packages/cli/src/main.ts`: when a first command runs setup, read from `setup-finished.json`;
  - `tests/acceptance/1463/helpers.ts`: `makeWorld`, which writes that marker; `NOON`; `deep`;
  - `tests/acceptance/16/helpers.ts`: `deep`, `childEnv`, `startHub` and `stopHub`;
  - `scripts/lanes.mjs`: `alone` and `redrafted`;
  - `scripts/proof-change.mjs`: the tag rule. I recomputed the IDs from the issue's text: `#2331.04651a1b` and
    `#2331.aee6e8f0`.
- I never read an implementation of #1812, a commit after the base, a branch, a pull request, another worktree or an
  uncommitted change.

## What #1812 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds under #1812 | Replaced by |
|---|---|---|---|
| `2331/inbox.test.ts` › `#2331.04651a1b: deep inbox, the hub down, says since when, writes each ask's default and its time, and constructs no date or number formatter` | #2331 AC1 `#2331.04651a1b` | Check (c) holds stdout's first line to exactly `The hub isn't answering, since <HH:MM>; this is the list its database holds.` Four sentences change that line. #1812's Scope, first item: one sentence "that it isn't answering, since when if the record says, and the one fix, … else `deep hub start`". Its AC1: each command that calls the hub, `deep inbox` named, "prints the one sentence with its fix and exits 3". Its suite's Surfaces 1: the sentence is "one line of the command's output (stdout or stderr)" with "on that same line the one fix". The design's deep CLI row: the sentence is "the same from every command". The base's line names no fix, so a correct #1812 fails (c). An implementation that prints the sentence on stderr fails it at stdout's first line | `2331-redraft-1812/inbox.test.ts` › `#2331.04651a1b: deep inbox, the hub down, says since when and the one fix, deep hub start, writes each ask's default and its time, and constructs no date or number formatter (redraft 1812)`. The world, the run and checks (a), (b), (d) and (e) are copied unchanged. Check (c) now finds the first line of the output, stdout then stderr, that says the hub isn't answering, as #1812's suite reads it. On that line it holds `since <HH:MM>` at one of the same minutes, with the time written whole; the fix `deep hub start`; and neither `deep setup` nor `BLOCKED` |

The test, part by part:

| Part | In the frozen test | In the redraft |
|---|---|---|
| The world | #1463's `makeWorld`: noon today in Asia/Kolkata, one session, three asks whose defaults fall today, tomorrow and in three days. `deep inbox --json` is read with the hub up, then the hub is stopped by PID | Kept as it is |
| The run | `deep inbox` with the preload, `NODE_OPTIONS=--require …/2331/count-formatters.cjs` | Kept as it is |
| (a) The exit | 3, read from the database | Kept. #1812's AC1 also says 3 |
| (c) The hub-down line | stdout's first line is exactly `The hub isn't answering, since <HH:MM>; this is the list its database holds.` `<HH:MM>` is the base clock's text for a minute the hub's last event could carry: by the hub's clock, from 11:59 to 12:21 plus the time since the hub's second start; or by the wall clock, from a minute before the world was made to a minute after the run | Changed. The first line of stdout, then stderr, that names the hub and says it isn't (or is not) answering. That line: says `since <HH:MM>` at one of the same minutes, not followed by seconds or by am/pm; names `deep hub start`; names neither `deep setup` nor `BLOCKED` |
| (b) Each ask's default | The stdout line holding each ask's handle holds `If you don't answer: <label>, <the oracle's when>` | Kept as it is. `deep inbox` still prints the list its database holds (#1812's suite, its reading 4) |
| (d) A record from `deep inbox`'s process | Required | Kept as it is |
| (e) No formatter | Zero `Intl.DateTimeFormat`, `Intl.NumberFormat` or `toLocale*String` calls in the process, each named with its stack | Kept as it is. It now also covers the one function that writes the sentence's time |

No assertion of the test is dropped. Only the code of check (c) and the test's name differ from the frozen file. Its
helpers, the fixture and the other checks are copied byte for byte. The one import path changes from `./kit.ts` to
`../2331/kit.ts`.

## Kept as they are, and why

- `2331/inbox.test.ts` › `#2331.04651a1b: deep inbox, the hub up, writes each ask's default and its time and constructs
  no date or number formatter`. With the hub up, `deep inbox` prints no hub-down sentence. Nothing #1812 names touches
  its exit 0, its ask lines, the literal `If you don't answer: No, at 16:40` or its count. Both tests read the asks from
  `deep inbox --json`, which keeps its JSON (#1812, Scope: "JSON only with `--json`").
- `2331/week.test.ts`, three tests under `#2331.aee6e8f0`. `when` and `clock` in `packages/hub/src/list.ts` keep their
  text. #1812 changes which sentence carries the time, not how a time is written.
- `2331/judges.test.ts`, five tests with no tag. They hold the week comparison and the preload to wrong programs.
  Nothing of #1812 reaches them.
- `kit.ts`, `count-formatters.cjs`, the twins and `twins.json`. The redraft imports `kit.ts`, which loads
  `count-formatters.cjs`. The other files are left as they are.

## Readings where #1812 leaves room

1. **This home is set up, so its one fix is `deep hub start`.** `makeWorld` writes `~/.deepbuild/setup-finished.json`,
   #1002's marker, "so no `deep` command here runs it". The CLI reads that marker to decide whether a first command
   runs setup (`packages/cli/src/main.ts`, `unfinished`). The owner's first comment on #1812 uses the same notion: in a
   home that isn't set up, `inbox` and the other first-run commands "run setup's steps themselves" (#1002). Here
   `deep inbox` doesn't run setup, so `deep setup` isn't its fix. #1812's own suite sets its homes up with `deep setup`
   (its reading 2); this one is set up by the marker alone, and `deep setup` never ran in it. An implementation that
   judged "set up" by something setup leaves behind other than the marker, such as the login service's entry, would
   name `deep setup` here, and this redraft would fail it.
2. **The sentence's line is the first line of the output, stdout then stderr, that says the hub isn't answering.**
   That is how #1812's suite's `hubDownFailures` finds it. Its words are held as that suite holds them: it names the
   hub and says `isn't answering`, `isn’t answering` or `is not answering`. The frozen test held stdout's first line and
   the base's exact words. #1812's Surfaces 1 lets the sentence go to either stream, and its reading 4 lets other lines
   be printed.
3. **Since when stays `since <HH:MM>`, with the time written whole.** #1812's Scope keeps "since when if the record
   says", and the record says it here: the database holds the hub's events, and the base takes the newest one's time.
   #1812's suite doesn't read since when ("'Since when' is the implementation's: it isn't read"). #2331 does: the frozen
   check held the base's form, `since `, then the clock text, then `;`. So the redraft holds `since <HH:MM>` (either
   case) at the same minutes as the frozen test. The time must not be followed by seconds (`:45`) or by a 12-hour
   clock's `am` or `pm`. A sentence that writes its own time some other way fails where the frozen line did. What
   follows the time is #1812's to choose.
4. **"This is the list its database holds" isn't held.** The design line makes the sentence "the same from every
   command", and most commands print no list, so the base's clause can't stay part of the sentence. #1812's suite lets
   other lines be printed. Whether `deep inbox` still says it, on the sentence's line or another, is #1812's to decide.
   Check (b) still holds the list itself.
5. **Nothing past the line is added.** #1812's AC1 also says that nothing a command prints holds an errno or the same
   path twice. That is #1812's own test: `deep inbox` is a row of its suite's table. The frozen test held nothing of the
   output beyond its first line and the asks' lines, so the redraft adds no check there.
6. **A blind spot kept from the frozen test.** In this world the hub's clock reads about 12:20 when it stops (12:20 on
   the base run). At that hour a 12-hour clock with no am or pm writes the same digits, so neither test can tell the two
   apart there. Criterion 2's week test holds `clock` itself.

## Wrong programs it still fails

- The base itself, where #1812 isn't implemented. It fails check (c): "it doesn't name the one fix in a home that is set
  up, deep hub start" (BASE-RESULTS.txt).
- A #1812 sentence that fails check (c):
  - it has no since when;
  - its time is unpadded, in UTC, carries seconds or am/pm, or is a minute at which the hub couldn't have stopped;
  - it names `deep setup` in this set-up home, or both fixes, or leads with `BLOCKED`;
  - its fix sits on another line;
  - it comes after another line that says the hub isn't answering with no fix.
- A sentence whose time comes from `toLocaleTimeString` or `Intl.DateTimeFormat`, as before #2331 (the frozen suite's
  `locale-clock` twin). It fails check (e), naming the call and its stack.
- A `deep inbox` that stops printing the list with the hub down, or that drops or rewrites a default's time. It fails
  check (b).
- A run the preload never reached fails (d). An exit other than 3 fails (a).

Twenty sample outputs were held to check (c) in a scratch script, which is not kept. The base's line failed on the fix
alone. The sentence passed with backticks, with a curly apostrophe, with `Since` first, with a colon after the time, and
on stderr. It failed with no since when, an unpadded hour, seconds, `pm`, `p.m.`, a minute outside the window,
`BLOCKED`, `deep setup`, both fixes, the fix on the next line, a fixless sentence before the right one, and no sentence.

## On the base

`BASE-RESULTS.txt` holds the one run at `c0a9de979` on November 18, 2026. One test ran and failed, in 7.9 s. It failed
at check (c) on the missing fix alone. The base printed `The hub isn't answering, since 12:20; this is the list its
database holds.` and exited 3; its since when was one of the minutes the check allows. #2331 has landed at this base.
A scratch copy with (c) moved last, deleted after one run, showed the rest of the test passing on the base:

- the preload left one record from `deep inbox`'s process, with no formatter;
- each ask's line held its default and its time.

So the redrafted test fails at #1812's change and nowhere else. The type check is clean.

Not run: any implementation of #1812, since none exists here. The redraft's passing side, a sentence with its fix, was
checked only against the scratch script's sample lines.

## Run it

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                    # once
npm run build --workspaces                # the test runs packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # #1463's world needs it
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2331-redraft-1812 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2331-redraft-1812/tsconfig.json
rm -rf tests/acceptance/2331-redraft-1812/node_modules/.vite
```

The file imports `../2331/kit.ts`, `../1463/helpers.ts` and `../16/helpers.ts` unchanged; `kit.ts` loads
`../2331/count-formatters.cjs`. A missing build or deep-hook, or a hub that doesn't start, reads BLOCKED and never
passes. The world's folders are under `/tmp/dh16-*` and `/tmp/dh26-*` and are removed at the end. Only processes the
test started are stopped, by PID. No model is called and nothing leaves the machine.

## At merge

- The frozen `tests/acceptance/2331/inbox.test.ts` stays as written. Its first test, with the hub up, still holds. Its
  second fails on a correct #1812 at check (c). The owner's call is to run this redraft in its place. Both carry
  `#2331.04651a1b`.
- The proof lanes read a test's twins from its own acceptance folder. So `tests/acceptance/2331/twins.json`, which maps
  the tag to the `locale-clock` twin, covers this test only once it sits under `2331/`. This folder has no
  `twins.json`.
- Each twin is the whole `list.ts` from the frozen suite's base. If #1812 changes that file, the twins differ from it in
  more than the clock, and regenerating them is the implementer's job at the swap.
- `scripts/lanes.mjs` lists neither `tests/acceptance/2331/` nor this folder, so this job's brief adds nothing there.

## Found on the way

- The frozen suite has no BASE-FAILURE file at this base, though this job's brief lists one.
- The frozen suite starts real hubs, through #1463's world, but `scripts/lanes.mjs` lists it nowhere, while
  `tests/acceptance/1463/` is on `alone`. This folder is in the same position. Neither is changed here.
- Three more suites name the base's hub-down line in their tests or helpers: `tests/acceptance/1461/`, `2026/` and
  `1463/`. I didn't read what they hold of it. Whether #1812 changes their tests is for their own redrafts.
- The frozen README still lists criterion 3, "`tests/acceptance/1463/` passes as it does on main", which moved to #2740
  on Nov 16.

## Files

`REDRAFT.md`, `inbox.test.ts` (the one redrafted test), `tsconfig.json` (the frozen suite's, less its twins exclusion)
and `BASE-RESULTS.txt`.
