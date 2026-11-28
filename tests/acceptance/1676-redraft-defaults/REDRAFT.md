# #1676 AC1 blind redraft (defaults): the merge base's deep-hook meets the defaults it shipped with

#1676's wrong-program test runs deep-hook built from the pinned merge base `433c07af` (`helpers.ts`, `BASE`,
`buildBase`) against a home whose first `rules.json` is the checkout's `crates/deep-hook/default-rules.json`
(`seedDefaults`, through `stoppedHome`). When the suite was written the checkout was that commit, so the two matched.
At the base commit of this redraft (`0beb4a141`) the checkout's file holds `no-delete-past-worktree`
(`effect:unrestorable-delete`, block, fail_closed), which the pinned file doesn't. The pinned matcher's `known()` reads
`effect:` only for a class in its `EFFECTS` list, and `unrestorable-delete` isn't one, so the pinned `rules()` refuses
the whole file ("has an entry no-delete-past-worktree that isn't a guard@1 entry") and the hook entry denies every
call, exit 2. It then never allows a spelling, the judge's message holds no "`<call>` must be denied", and the test
fails for a reason that isn't the criterion's. The redraft keeps the test's scenario, judge, assertions and messages,
and starts the merge base's home from the defaults the merge base itself shipped.

Written from issue #1676 (read live with `gh issue view 1676 --repo windoliver/deepbuild`: its statement, Scope, the
three criteria, Proof and Depends on; the issue is closed; no comments or linked pull requests read), the design
(`docs/technical-design.md`: Wrong programs, Proven on the base and the Dogfooding paragraph, found by a search; of
the linked Before each command section only the lines a `grep` for `hub down`, `unread`, `fail_closed`, `guard@1` and
`rules.json` printed, since the scenario doesn't change), `AGENTS.md`, the frozen `tests/acceptance/1676/` (README.md,
BASE-FAILURE.txt, helpers.ts and spellings.test.ts in full; tsconfig.json was not opened, its form is the #1097
redraft's; twins.test.ts and corpus.test.ts not read), and for form `tests/acceptance/1097-redraft-defaults/`
(REDRAFT.md, base-defaults.ts, computed.test.ts, tsconfig.json). At the pinned commit `433c07af`, with `git show`:
`crates/deep-hook/default-rules.json` (every entry's name, match, mode and fail_closed, and that `no-deepbuild-home-write`
is there, block and fail_closed), and from `crates/deep-hook/src/main.rs` `home()`, the `Guard` and `Rules` structs,
`rules()`, `standing()`, `classes()`, `guard()`, and the lines of `forward()` that read `rules()` and set the denial
for an unreadable file (lines 1105-1150), plus `cloud_owner()`, which sat between them; from `matcher.rs` `CLASSES`,
`EFFECTS` and `known()` (lines 80-140, with `holds_word()` and the first lines of `Call::new`, which sat between them).
At the base commit `0beb4a141`: `default-rules.json`'s entry names, matches, modes and fail_closed. I checked both
files against the pinned reader with a short script that restates `known()` and `guard()`'s field rules: the pinned
file has no entry that reader can't read; the checkout's has one, `no-delete-past-worktree`.

**The hub at the base commit, read only as far as needed** (does the hub the test starts rewrite `rules.json` with
entries the pinned reader can't read?). I listed `rules.json` and `default-rules` mentions in `packages/hub/src`
(non-test files, by `grep`) and read: `server.ts` lines 380-425 (the start: `this.rules()` once before any hook, and
`this.rules(false)` on the lock-check interval), 518-530 (`this.rules()` on each connection), 668-690 (`this.rules()`
before a hook is answered), 1040-1085 (`rules()`: it rewrites `rules.json` only with the text it last read, when the
file is removed or unreadable, and never adds an entry); `guards.ts` lines 80-105 (`restoreShipped`, which writes
`proofs.json`, not `rules.json`, and is called only from `setup.ts`, by `grep`) and 196-232 (`rewriteRules`,
`writeStanding`, `dropEntries`, `writeRejected`: each keeps every entry the file holds, and writes only when its
member changes); `session-memory.ts` lines 524-536 (`syncStanding`, which calls `writeStanding`); and, from a `grep`
hit, `core.ts` lines 1810-1820 (`deniedBefore`, a reader). So the only writes a fresh home's hub can make keep the
seeded entries: `standing` (an empty list equals an absent one, so no write) or `rejected-*`/`memory-*` entries from
decisions a fresh record doesn't hold. Nothing there copies `default-rules.json` into `rules.json`. None of these
lines is #1676's work as far as I can tell (they are #2204, #1856, #2695, #23 and #111's), but I can't rule out that
some were touched later by it; no test line depends on them.

**What reached this job beyond its inputs.** The base run's failure, in the instructions: running the frozen first
draft on main `9fd3774c7` (macOS, 2026-11-27), `tests/acceptance/1676/spellings.test.ts` › "AC1 (wrong program) …"
fails naming the wrong reason for each spelling, because the merge base's deep-hook exits 2 on every call with stderr
"~/.deepbuild/rules.json has an entry no-delete-past-worktree that isn't a guard@1 entry, so deep-hook can't check its
guards while the hub doesn't answer"; every other test in that file passes; and that `seedDefaults` copies the
checkout's file, which has gained entries since the pin. I checked the cause against the pinned `known()` and
`EFFECTS`, not the entry's history.

## What changed since the suite was written

| Original (path › describe title › it title) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `tests/acceptance/1676/spellings.test.ts` › AC1 #1676.d3016290 with the hub stopped, each spelling is denied: the inline ones naming the guard, the others naming what couldn't be read › AC1 (wrong program) deep-hook at the merge base allows each spelling and fails this test, naming the call | #1676 AC1 | The pinned reader can't read the checkout's defaults (`no-delete-past-worktree`, `effect:unrestorable-delete`, isn't in its `EFFECTS`) and denies every call, exit 2, naming no guard. The judge then throws "`<call>`: the denial must name the guard no-deepbuild-home-write…" and "`<call>`: the denial must be a shipped fail_closed block guard's…", never "`<call>` must be denied", so `toContain(\`<call>\` must be denied)` fails, and each call is `deny`, not `allow` (the base run) | `tests/acceptance/1676-redraft-defaults/spellings.test.ts` › the same describe › AC1 (wrong program) deep-hook at the merge base allows each spelling and fails this test, naming the call (redraft defaults) |

### The seeding choice

`stoppedBaseHome()` (`base-defaults.ts`, the redraft's one local addition) is the frozen `stoppedHome()` with no
`whileUp`, seeded by `seedBaseDefaults(home)`, which writes `git show 433c07af…:crates/deep-hook/default-rules.json`
verbatim as `<home>/.deepbuild/rules.json`, as `seedDefaults` writes the checkout's. The hub is then started and
stopped by its PID, as before. Why that file:

- **It is the wrong program as a whole.** The design's Wrong programs: "For a fix, the merge base is that program."
  The criterion names "deep-hook on the merge base"; that deep-hook shipped with that `default-rules.json`, and the
  README pins it by the same commit. Every entry in it is one the pinned reader reads (checked above), and it is the
  file the first draft's base run used, when the checkout was the pin.
- **The criterion's entries are in it.** `no-deepbuild-home-write` (`write:~/.deepbuild ~/.deepbuild/* …`, block,
  fail_closed) covers `~/.deepbuild/rules.json` in both files (the checkout's adds `!~/.deepbuild/worktrees/*`), and
  the pinned file's fail_closed block entries are the ones an unread call would meet.
- **Not a filtered copy of the checkout's file.** Dropping the entries the pinned reader can't read would make the
  test decide, by a rule of its own, which entries those are, and the home would change with every new default; the
  pinned file never moves.
- **The hub keeps it.** From the hub code read above, the hub the test starts and stops writes `rules.json` only as it
  last read it, or with members a fresh record leaves unchanged, so the pinned reader still reads every entry.

The wrong program still fails for the criterion's reason. With a `rules.json` it can read, the merge base's deep-hook is
#1503's reader: no runner stepped over, no php `-n` cluster, no `env -S` of a computed value, written script or URL
program counted as unread. The first draft's base run (`tests/acceptance/1676/BASE-FAILURE.txt`, on the pin, whose
defaults this file is) shows exactly that: each of the twelve spellings exit 0, empty stdout and stderr, so `judgeAC1`
throws "`<call>` must be denied with the hub stopped: …" for each, which is what the test's `toContain` and `allow`
expectations require. The judge still reads `failClosedBlockNames()` from the checkout's defaults, as the original;
for the merge base it never reaches that branch, since each call is allowed first.

## Kept as they are

- **The redraft file runs in its original's place.** A `skips` entry can't retire a failing test, so
  `tests/acceptance/1676/spellings.test.ts` goes by hand, with this folder's file of the same name in its place, as
  the #1097 redraft does. So this file holds all three tests of the original: its two right-program tests (the
  spellings with this checkout's deep-hook, and the `curl -o` Scope spelling), with `beforeAll(buildDeepHook)` and
  `BIN`, copied exactly apart from their comments (below), titles unchanged, and the redrafted wrong-program test.
- The right-program spellings test still runs the checkout's deep-hook on the checkout's defaults: `observe` takes
  the home's maker as an argument, and that test passes the frozen `stoppedHome`, which is what the original's
  `observe` called. That argument is the only change in its body. The Scope test is the original's, byte for byte.
- The scenario (`observe`: a fresh home whose hub was started and stopped by its PID, one session, every spelling as a
  PreToolUse payload through the hook entry, a cwd with no `i.sh`), the judge (`judgeAC1`), the constants and every
  expectation and message are the original's; the only line that differs in `observe` is `await stopped()`.
  Everything else comes from `../1676/helpers.ts`, imported unchanged.
- The `describe` title is the original's word for word; the wrong-program `it` title is the original's with
  ` (redraft defaults)`.
- Not redrafted: `twins.test.ts` and `corpus.test.ts`, which the base run didn't name.

## No comments in the code (a change after the first hand-in)

The first hand-in of this redraft carried comments in both `.ts` files, the original's included, as the #1097 redraft
does. `node scripts/comment-ratchet.mjs` failed them: a blind suite not yet landed starts each file at a ceiling of 0
comment lines (the design's repo-guards bullet), reporting 8 lines in `base-defaults.ts` and 23 in
`spellings.test.ts`. Every comment was removed; no code changed. So the right-program tests are the original's code
exactly, without its comments. What those comments said, kept here:

- **`spellings.test.ts`.** #1676 AC1: with the hub stopped, each of the issue's five spellings is denied. The inline
  ones (a project runner before `python -c`, and `php -nr`) name the guard their text meets, `no-deepbuild-home-write`
  for `~/.deepbuild/rules.json`. The others (`env -S` of a computed value, a script the line writes then runs,
  `deno run <url>`) are partly unread under #1097's rule, so a shipped fail_closed block guard denies them, naming what
  couldn't be read. deep-hook at the pinned merge base allows each and fails the test, naming each call. Beside them
  is a Scope spelling with no criterion of its own: the script named by an earlier `curl -o`. No call is ever
  executed: each is a PreToolUse payload deep-hook decides on. `RUNNERS` are the project runners the issue lists, each
  before the same inline write of `~/.deepbuild/rules.json`. An `Inline` call must name the guard its text meets; an
  `Unread` call is denied by a shipped fail_closed block guard whose denial names `unread`. `observe` runs every
  spelling through `binary` on a home whose hub was started and stopped, in a cwd that holds no `i.sh`; its `stopped`
  argument is the frozen `stoppedHome` (the checkout's defaults, as the original) for the right program and
  `stoppedBaseHome` (the merge base's own defaults) for the merge base's deep-hook. `judgeAC1` lists every spelling
  not denied as the criterion says, in one message, so a wrong program's failure names each call.
- **`base-defaults.ts`.** The redraft's one addition to the frozen helpers. `seedBaseDefaults` copies `BASE`'s own
  `crates/deep-hook/default-rules.json`, read with `git show`, verbatim in as `<home>/.deepbuild/rules.json`.
  `stoppedBaseHome` is the frozen `stoppedHome` with no `whileUp`, seeded by `seedBaseDefaults` in place of
  `seedDefaults` (why: above).

## Run

```sh
npx vitest run --root tests/acceptance/1676-redraft-defaults --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1676-redraft-defaults/tsconfig.json
```

With the setup of `tests/acceptance/1676/README.md` (the hub and CLI built; `buildBase` builds the pinned deep-hook
under `target/base-1676/`; `git show` needs `433c07af` in the clone, as `buildBase`'s `git archive` does). 3 tests in
one file. The type-check is clean; the tests were not run by this job.
