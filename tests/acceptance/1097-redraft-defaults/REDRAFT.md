# #1097 AC1 and AC2 blind redraft (defaults): the merge base's deep-hook meets the defaults it shipped with

Two of #1097's wrong-program tests run deep-hook built from the pinned merge base `fad1c4cb` (`helpers.ts`, `BASE`,
`buildBase`) against a home whose first `rules.json` is the checkout's `crates/deep-hook/default-rules.json`
(`seedDefaults`). When the suite was written the checkout was that commit, so the two matched. The checkout's file
has since gained every default entry added since the pin whose match the pinned reader doesn't know, the first on
2026-11-05 (#1294): `no-discarding-edits` (`effect:discard-edits`) and `no-dropping-stash` (`effect:drop-stash`, both
#1294), `pr-needs-ask` (`effect:pr`, #84) and `no-unreadable-push` (`unread:push`, #1156), all 2026-11-05, and
`no-delete-past-worktree` (`effect:unrestorable-delete`, #1507, 2026-11-09). None is in the pinned matcher's `known()`:
its `EFFECTS` lists none of those four classes, and it has no `unread` kind. That reader refuses a `rules.json` holding
any entry it can't read, so it stops at the first such entry in file order and fails closed on every call, exit 2:
"~/.deepbuild/rules.json has an entry no-delete-past-worktree that isn't a guard@1 entry…". It names
`no-delete-past-worktree` only because that entry comes first in the file; any one of the five would do the same. It
then denies everything, the calls the criterion says it lets through included, and never shows the fault the test is
about. The redraft keeps each test's scenario,
judge, assertions and messages, and seeds the home with the defaults the merge base itself shipped.

Written from issue #1097 (read live with `gh issue view 1097`, `updatedAt` 2026-11-03T05:28:06Z: its statement,
Scope, the five criteria, Proof and Depends on; no comments or linked pull requests), the design
(`docs/technical-design.md`: Wrong programs, Dogfooding and Proven on the base, found by a search; the Before each
command and Threats sections were not reread, since neither test's scenario changes), `AGENTS.md`, the frozen
`tests/acceptance/1097/` (README.md, BASE-FAILURE.txt, tsconfig.json, helpers.ts, computed.test.ts, depth.test.ts in
full; warn.test.ts, install.test.ts and budgets.test.ts only searched for `buildBase` and `seedDefaults`),
`tests/acceptance/313-redraft-2551/` for form (REDRAFT.md, tsconfig.json), and at the pinned commit:
`crates/deep-hook/default-rules.json` (its entry names, `no-kill-by-name` and the push entries), and from
`crates/deep-hook/src/main.rs` its `rules()` and `classes()` readers and from `matcher.rs` `known()`, `CLASSES` and
`EFFECTS`, to learn which `rules.json` it reads. At the base commit `8b1b2bfce`: `default-rules.json`'s entry names
and matches, and the `no-delete-past-worktree` entry. For the run-in-place form, named in the follow-up: the
`scripts/lanes.mjs` lines naming #2204 and the head of `tests/acceptance/2204-redraft-ac3/DISPUTE.md`. I never read
`crates/deep-hook/src` at the base commit, any diff, branch, pull request or other worktree. I did read part of
#1097's implementation, in the hub: see the slip below.

**What reached this job beyond its inputs.** Two things, both in its instructions:

- The base run's failing file (`tests/acceptance/1097/depth.test.ts`), test, message and cause, as Proven on the base
  sends a check that fails elsewhere back to its drafting job with the base run's failing file, line and message,
  which come from the base commit alone.
- A follow-up's corrected cause, which goes beyond that file, line and message: the five default entries added since
  the pin whose match the pinned reader doesn't know, with each one's commit and date (#1294 0f65ca489, #84
  d6aacc01b and #1156 79c9892fd, all 2026-11-05; #1507 551b365a8, 2026-11-09). I checked their matches against the
  pinned `known()` and `EFFECTS`, not their history.

**A slip in the reading list.** To check that the hub the tests start doesn't put entries the pinned reader can't
read back into `rules.json` (which would defeat the fix), I searched `packages/hub/src` for `rules.json` writers and
read `guards.ts` lines 1-20 and 100-131 (the install's merge and rewrite) and `hookmap.ts`'s `toolClasses`. They show
the install keeps the entries `rules.json` holds, adds the given ones, and writes `classes` as `read` only, which the
pinned reader reads. Those lines include #1097's own implementation: the install's computed-program refusal for a
`fail_closed` `run:`/`effect:` entry (`computed(planted)`), which came in with #1097's change (ccd0a8c9e, "(#1097)";
an independent review found this, not this job). So this job did read part of #1097's hub install code. No test line
depends on it: the test bodies are the originals' apart from the seeding (`seedBaseDefaults`, and the `seed`
argument `observe` takes), and nothing in the redraft was chosen from what those lines say. They bear only on whether
`deep guard add` installs `t-push`, which the original's BLOCKED assertion, unchanged here, already holds.

## What changed since the suite was written

| Original (path › describe title › it title) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `tests/acceptance/1097/depth.test.ts` › AC2 #1097.68b4ff24 a line nesting sh -c 13 deep around pkill node is denied by the kill-by-name entry, saying it nests past the reader › AC2 (wrong program) a reader that stops at its depth and allows the call (deep-hook on the merge base) fails this test, naming the depth | #1097 AC2 | The pinned reader can't read the checkout's defaults and denies every call, the 12-deep control with no entry named. The judge throws on the control first, "the line nesting sh -c 12 deep around… must be denied by no-kill-by-name", which names no depth: `expected 'the line nesting sh -c 12 deep around…' to match /depth of 12/` (the base run). The 13-deep line is denied, not allowed | `tests/acceptance/1097-redraft-defaults/depth.test.ts` › the same describe › AC2 (wrong program) a reader that stops at its depth and allows the call (deep-hook on the merge base) fails this test, naming the depth (redraft defaults) |
| `tests/acceptance/1097/computed.test.ts` › AC1 #1097.35142c93 computed pushes are denied by the fail_closed push entry, naming the unreadable program; "$CC" runs › AC1 (wrong program) deep-hook on the merge base reads the program as empty, allows the push and fails this test, naming the call | #1097 AC1 | Same cause, worked out from the code, not run here: the pinned reader denies `"$(printf git)" push origin main`, exit 2, naming no entry, so the judge throws "`"$(printf git)" push origin main`: the denial … must be the push entry t-push's", which still contains the call, but the test's last expectation, that the merge base allows the push hub up and stopped, fails (`expected 'deny' to be 'allow'`). `"$CC" -o app main.c` is denied too | `tests/acceptance/1097-redraft-defaults/computed.test.ts` › the same describe › AC1 (wrong program) deep-hook on the merge base reads the program as empty, allows the push and fails this test, naming the call (redraft defaults) |

### The seeding choice

`seedBaseDefaults(home)` (`base-defaults.ts`, the redraft's one local addition) writes `git show
fad1c4cb…:crates/deep-hook/default-rules.json` verbatim as `<home>/.deepbuild/rules.json`, as `seedDefaults` writes
the checkout's. Why that file:

- **It is the wrong program as a whole.** The design's Wrong programs: "For a fix, the merge base is that program."
  The criteria name "deep-hook on the merge base" (AC1) and "a reader that stops at its depth" (AC2); the merge base's
  deep-hook shipped with that `default-rules.json`, which the README already pins it by. Every entry in it is one the
  pinned reader reads (it ran clean on that commit: BASE-FAILURE.txt).
- **The criteria's entries are in it, unchanged.** `no-kill-by-name` (`kill:by-name`, block, fail_closed), AC2's
  kill-by-name entry, is identical in both files. AC1's push entry is `t-push`, installed by `deep guard add` as before,
  and the pinned file's only push entry, `authority-push`, is watch mode and not fail_closed, as the README describes.
- **Not a filtered copy of the checkout's file.** Dropping the entries the pinned reader can't read would make the
  test decide, by a rule of its own, which entries those are, and its home would change with every new default; the
  pinned file never moves.

The twin still fails for the reason the original names. AC2: the 12-deep control is denied by `no-kill-by-name`
(base `deep-hook check` matched it, BASE-FAILURE.txt), the 13-deep line is dropped past depth 12 and allowed, and the
judge throws "the line nesting sh -c 13 deep around pkill node, past the reader's depth of 12, must be denied…",
which names `depth of 12`. AC1: `"$(printf git)" push origin main` reads as no program, meets no entry and is allowed,
and the judge throws "`"$(printf git)" push origin main` must be denied with the hub up…", which names the call.

## Kept as they are

- **Each redraft file runs in its original's place.** A `skips` entry can't retire a test that fails, so
  `tests/acceptance/1097/computed.test.ts` and `depth.test.ts` run by hand only, with this folder's file of the same
  name in their place, as #2204's first draft does (`scripts/lanes.mjs`, the `byHand` line for
  `tests/acceptance/2204/rules-unreadable.test.ts`). So each file here holds both tests of its `describe`: the
  original's right-program test, with its `beforeAll(buildDeepHook)` and `BIN`, copied exactly, title unchanged and
  marked "Copied exactly", and the redrafted wrong-program test. The right-program test still runs the checkout's
  deep-hook on the checkout's defaults: `observe` takes the seeding as an argument, and that test passes the frozen
  `seedDefaults`, which is what the original's `observe` called. That argument is the only change in its body.
- Each test's scenario (`observe`: a fresh home, one session, the hub up then stopped by its PID, for AC1 `t-push`
  installed through `deep guard add` with the hub up), its judge (`judgeAC2`, `judgeAC1`), its constants and its
  expectations and messages are copied exactly from the original; the only line that differs in `observe` is the
  seeding call, `seed(home)`. Everything else comes from `../1097/helpers.ts`, imported unchanged.
- The `describe` titles are the originals' word for word. The right-program `it` titles are the originals'; each
  wrong-program `it` title is the original's with ` (redraft defaults)`.
- Not redrafted: `warn.test.ts` (the `unknown-as-block` hub plant), `install.test.ts` (the `plant-computed-misses`
  cargo twin) and `budgets.test.ts`, none of which uses `buildBase`.

## Run

```sh
npx vitest run --root tests/acceptance/1097-redraft-defaults --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1097-redraft-defaults/tsconfig.json
```

With the setup of `tests/acceptance/1097/README.md` (the hub and CLI built; `buildBase` builds the pinned deep-hook
under `target/base-1097/`). 4 tests in 2 files: in each, the original's right-program test and the redrafted
wrong-program test. The type-check is clean; the tests were not run by this job.
