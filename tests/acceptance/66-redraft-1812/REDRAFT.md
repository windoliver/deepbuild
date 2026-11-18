# #66 criteria AC1 and AC5 blind redraft, after #1812: `deep fix` prints a sentence, and its object only with `--json`

#66's AC1 (`#66.3e42b2ec`, "\"Fix LIN-42\" starts work from a Linear issue, with its acceptance criteria in what done
means") and AC5 (`#66.3ddbb14e`, "A Linear comment from someone outside the project that says to skip a requirement
leaves it in the definition, and the definition waits for your one answer") each end on the real hub, in
`tests/acceptance/66/fix.test.ts`. There `deep fix <id>` opens the task, and #66's README pins its output: "It exits 0
and prints one line, `{"task":"<task_ref>","link":"<the item's link>"}`". Both tests read the task's ref and link from
that line through one helper, `fix()`, and follow the record by that ref.

#1812 moves that line. Its Scope's fifth item says "A command a person runs prints a sentence, and JSON only with
`--json`: `deep fix`, `deep workspace`, `deep rules` and `deep numbers refresh`". Its seventh criterion
(`#1812.eabaa642`) says "`deep fix` on a fixture issue prints one sentence naming what started, and with `--json` prints
the object the merge base printed, byte for byte". The design's deep CLI row, at the base, says "What a person runs
prints sentences, and JSON only with `--json`." Under a correct #1812, `fix()`'s `JSON.parse` of the sentence throws,
and both tests end before their hub half asserts anything. The criteria still hold. The redraft reads the same object
through `deep fix <id> --json`, the flag after the ID as #1812's blind suite pins it (its README, Surfaces 7), and keeps
every other step and assertion.

Written from issue #66 (closed: its Scope and 18 criteria, and its one comment, the owner's) and issue #1812 (open: its
Scope, eight criteria, Proof and Depends on, and the owner's two comments of Nov 10), each read live with `gh issue
view`; the IDs of #66's AC1 and AC5 and of #1812's AC7 were computed again from the live bodies. Also read: #1812's
blind suite at the base, `tests/acceptance/1812/` (README.md, above all "Surfaces pinned here", item 7; `fix.test.ts`;
`fixtures/work.json`; `helpers.ts`'s `hubRun`; BASE-FAILURE.txt's summary), which holds tests, not an implementation.
From the design at the base: the deep CLI row under "One hub per user, a tiny hook client, and extensions in-process",
States people see, and Dogfooding; and AGENTS.md (Proof). The frozen `tests/acceptance/66/`: README.md,
BASE-FAILURE.txt, `fix.test.ts`, `helpers.ts`, `hub.ts`, `worlds.ts` and `budgets.test.ts`, with every other test file
searched for the CLI. For form: `tests/acceptance/19-redraft-2073/` (REDRAFT.md, BASE-RESULTS.txt and its test names)
and `tests/acceptance/556-redraft-ac5/README.md`. And the base `c0a9de979`, read only for how the surfaces are driven:
`packages/hub/src/fix-command.ts` (`deep fix` takes one argument and prints its JSON line), `packages/cli/src/main.ts`
(the fix route), `benchmarks/budgets.json` and `benchmarks/plugin-blocks.mjs` (#66's perf-lane task),
`scripts/lanes.mjs`, and `scripts/proof-change.mjs` (how a test's tag is read). I never read an implementation of #1812,
a commit after the base, a branch, a pull request, another worktree or an uncommitted change.

## What #1812 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds under #1812 | Replaced by |
|---|---|---|---|
| `66/fix.test.ts` › AC1 #66.3e42b2ec "Fix LIN-42" starts work from a Linear issue, with its acceptance criteria in what done means › AC1 Fix LIN-42 reads the Linear issue, made before the switch-on, and its three criteria are what done means | AC1 `#66.3e42b2ec` | Its `fix()` runs `deep fix LIN-42` and parses the last stdout line as `{"task","link"}`. Under #1812's fifth Scope item and AC7, that command prints one sentence naming what started, and JSON only with `--json`. The sentence isn't JSON, so the test fails before its hub half and never checks the link, `task.created` or the lock with the three criteria | `66-redraft-1812/fix.test.ts` › the same name, with the ID and "(redraft 1812)": `deep fix LIN-42 --json`, read as before (exit 0, the last line parsed, `task` a string), then the same assertions |
| `66/fix.test.ts` › AC5 #66.3ddbb14e A Linear comment from someone outside the project that says to skip a requirement leaves it in the definition, and the definition waits for your one answer › AC5 olu's "skip the second criterion" leaves R2 in; the definition waits for one ask and locks on your answer with R2 | AC5 `#66.3ddbb14e` | The same `fix()`, on `deep fix LIN-43`: the test fails before it checks the one ask, the lock that waits, your answer and R2 kept | `66-redraft-1812/fix.test.ts` › the same name, with the ID and "(redraft 1812)": `deep fix LIN-43 --json`, the rest as #66 wrote it |

| Part of each test | In #66's test | In the redraft |
|---|---|---|
| The host half: the shipped Linear source, `h.fix(YOU, id)`, the task's ID, link and criteria, its readings, olu read as outside | as #66 wrote it | Kept as it is |
| The hub: `deep hub run` with those readings (for AC5, the drafted R1 to R3 and olu's waiver of R2 too), ready on its `{"ready": true}` line | as #66 wrote it | Kept as it is |
| The fix | `deep fix <id>`: exits 0; its last stdout line parsed as JSON; `task` a string | Changed: `deep fix <id> --json`, with the same three checks |
| AC1 after the fix | `link` is the Linear task's link; `task.created` for the task; the lock's requirements are LIN-42's three criteria | Kept as it is |
| AC5 after the fix | one ask; no lock on outside text 3 s on; `deep inbox answer ask:<id> <option>` exits 0; the lock keeps R2; never asked twice | Kept as it is |

No expectation is dropped. Only the command's arguments (`fix.test.ts:26`) and the two messages of the helper's checks
change.

## Kept as they are

- The other fifteen test files of `tests/acceptance/66/`: `email`, `rules`, `kit`, `identity`, `budgets`, `failed`,
  `backlog`, `crash`, `markers`, `gone`, `unknown`, `order`, `watch`, `pages` and `fits`. By a search of the suite, only
  `fix.test.ts` runs the `deep` CLI (it alone imports `hub.ts`). The others drive the extension host in process, which
  #1812 doesn't touch. `budgets.test.ts`'s perf-lane task runs `benchmarks/plugin-blocks.mjs work-item`, in process too.
- The helpers. `../66/helpers.ts`, `hub.ts`, `providers.ts` and `worlds.ts` are imported unchanged: `hub.ts`'s `deep`
  takes any arguments, so the flag needs no helper change, and no file is copied.
- In `fix.test.ts` itself, `deep hub run` and `deep inbox answer` (Readings, 3).

## Readings where #1812 leaves room

1. **Where the flag goes.** After the ID, `deep fix LIN-42 --json`, as #1812's blind suite pins it (Surfaces 7:
   "`deep fix ACME-43 --json` (the flag after the ID)"). The Scope's "No new command, and no new flag beyond `--json`
   where a sentence replaces JSON" leaves no other flag to choose.
2. **The object is #66's.** #1812's AC7 has `--json` print "the object the merge base printed, byte for byte". The
   base's `deep fix <id>` printed `{"task":"<task_ref>","link":"<the item's link>"}` and a newline, #66's README's
   line. So the redraft reads `--json`'s output as #66's test read the plain output: its last line, `task` a string,
   and `link` compared with the Linear task's link. It adds no byte-for-byte check, which is #1812's AC7, in #1812's
   suite.
3. **What else the file runs stays.** `deep hub run` is the hub itself and not one of the Scope's four commands, and
   #1812's own suite reads its `{"ready": true}` line as JSON, as #66's does. `deep inbox answer` isn't one of them
   either. Its output isn't read here, and its exit 0, with the OS confirmation stub saying `confirmed`, is "0 done" in
   #1812's exit table. No confirmation is cancelled here, so the Scope's exit 3 for one never applies.
4. **The sentence isn't read here.** The person's form, `deep fix <id>` with no flag, prints a sentence that names the
   issue, its task or its title (#1812's Surfaces 7), not always the task's ref or link. #66's tests need the ref to
   follow the record, and States people see keeps code from deciding anything by matching display text. That the
   plain form exits 0 with its sentence is #1812's AC7 test. One limit follows. A program whose `deep fix <id>`
   without the flag printed its sentence and opened nothing would pass this redraft. #66's test, which ran only the
   plain form, would have caught it, and #1812's AC7 test reads that form's exit and sentence, not the record. Holding
   both forms here would take a second `deep fix` of the same issue. #66's criteria don't name one, and it would change
   AC5's one-ask scenario, so it was left out.

## On the base

`BASE-RESULTS.txt` holds the run at `c0a9de979` on November 18, 2026: 2 tests, 2 failed, in 23 s. Each failed at
`deep fix <id> --json exits 0`, with exit 2 and the base's usage line, since the base's `deep fix` takes exactly one
argument (`packages/hub/src/fix-command.ts`). Before that, each test's host half passed and its hub started. None ended
BLOCKED or at an import, a fixture or a typo.

A scratch copy of the file, run once and not kept, had its helper run the base's plain `deep fix <id>`, which prints
the object #1812's AC7 has `--json` print. Both tests passed, in 32 s. So once `deep fix <id> --json` prints that object,
the rest of each test holds on this base.

Not run: any implementation of #1812, since none exists here.

## Run it

macOS, with the repo's Node (24.22.0):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                    # once
npm run build --workspaces                # the deep CLI and the hub
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # the hub won't start without it
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/66-redraft-1812 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/66-redraft-1812/tsconfig.json
rm -rf tests/acceptance/66-redraft-1812/node_modules   # Vitest's cache from --root
```

As in #66's suite, the run starts the shipped Linear source sandboxed out of process and a hub, so it needs a shell
that may start the platform sandbox (#66's README, Run). Every folder is under `/tmp/dh66-*` and removed after the file.
Processes are stopped by PID.

## At merge

The frozen `tests/acceptance/66/fix.test.ts` stays as written. Swapping it for this file is the owner's call; the
redraft's tests carry the same tags, `#66.3e42b2ec` and `#66.3ddbb14e`. This commit adds
`'tests/acceptance/66-redraft-1812/'` to `scripts/lanes.mjs`'s `alone` list, where `'tests/acceptance/66/'` is, since it
starts sandboxed plug-ins and a hub. Moving the frozen file to the by-hand lane is the implementer's, at the swap.

## Files

`REDRAFT.md`, `BASE-RESULTS.txt`, `tsconfig.json` (#66's) and `fix.test.ts`, which imports `../66/helpers.ts`,
`hub.ts`, `providers.ts` and `worlds.ts` unchanged.
