# Blind redraft: three criteria the issue gained (#31, AC16 to AC18)

Additions only. No existing assertion, expected value, test name, tag, fixture or line of a kept file changed; README.md's
table, its count of criteria and its SURFACE block grew, and this entry was added.

What changed: issue #31 now has 18 checkbox criteria; the blind suite mapped 15. Two files were added, by a job that saw the
issue, the design, AGENTS.md, this folder and the base commit, and no implementation:

- `budget-snapshot.test.ts`: AC16 `#31.2ec94f1d` and AC17 `#31.73577be6`. One fixture, built once per file: the sample repo
  with 300,000 small untracked files under `u/<folder>/<n>.txt`, each with its own bytes (2.8 s to build here). AC16 reads a
  stop's claim on it through `runClaim`: INCONCLUSIVE within 11 s by the test's clock, a reason with `snapshot over budget`
  and `300,000`, no live git descended from the test process when it resolves (read from `ps`, never signalled), and no
  check call. AC17 starts the small repo's stop 200 ms after the big one's on the same service and reads it within 11 s of
  its own start, resolved while a git of the big snapshot still runs, and PASS. Plants: `snapshot-unbounded` (the snapshot's
  git awaited with no bound) and `snapshots-one-at-a-time` (one queue for every repo's snapshot).
- `hub-env.test.ts`: AC18 `#31.3c1a9f39`, through the real hub and deep-hook as AC15's hub test goes, with a copy of
  `startHub` that adds `GIT_DIR` and `GIT_WORK_TREE` (another repo beside the world's, holding `OTHER.txt`) and
  `GIT_CONFIG_PARAMETERS` (`core.excludesFile` naming the untracked `src/extra.ts`) to the hub's environment alone. The
  snapshot is the `run.started` commit of the stop's claim that isn't the repo's base, resolved with git in the claim's repo
  and every `objects` folder under the world as alternates; its parent must be the claim repo's HEAD, its tree must hold
  the edit and `src/extra.ts` and not `OTHER.txt`, and a run must name the claim repo's base. Each message names the
  variable. The wrong program is the hub plant `DEEP_HUB_PLANT=git-inherits-env`; the base refuses the name, so that test
  is BLOCKED there, never a pass.

Why: the issue's redraft added the snapshot budget, the independence of two repos' snapshots and the clearing of git's
location and config variables; the proof lanes had no test to link to those three tags.

Proof: on the base, the four service tests fail with `openCheckouts is not a function`, as the other 51; AC18's real-program
test fails at its assertion, the base hub having snapshotted the other repository (`expected 'none' to be <the claim repo's
HEAD>`, the other repo's root commit having no parent); its wrong-program test is BLOCKED. `BASE-FAILURE.txt` has the
output. A throwaway measurement (not kept) staged the 300,000 files into a separate object store in 6.8 s on this Linux
box, under the 8 s of git work alone; the checkout of the same tree is what the budget also counts.

Not run: any test against an implementation, so neither planted program has been seen to fail, and the 11 s readings have
not been taken against a bounded snapshot. `twins.json` was not changed: the implementer adds the three twins there, as for
the first fifteen.

## Fixture-only redraft of `hub-env.test.ts` (same day)

Two readings changed, no assertion, expected value, name or tag. `objectDirs` now descends into every folder, `objects`
included, and collects every `objects` folder at any depth (node_modules still skipped): it used to stop at the first
`objects`, so a bare store itself at a path named `objects`, with its own objects in `<store>/objects` as README.md
describes, was never found, and a real run reported the snapshot resolving in no store. In `stopUnder`, an event of the
claim is matched by its `subject` or its data's `claim`, for `verdict.made` and `run.started` alike, so the settle ends
as soon as the claim has a verdict and a recorded run; a real run had waited the full 120 s with the verdict there. Type
check: no error in the file. Not run: the test itself.

A third fixture change, same day: the drafted check. The test reused h-d.ts's `CHECK_BYTES`, which reads `src/auth.js`;
the repo has only `src/auth.ts`, so that check failed on every head, a check failing on the head got no base run, and the
assertion "the fix check also ran on the merge base" could hold on no implementation. `worldWithOther` now writes
`.deepbuild/checks/expired-token.sh` as `grep -q 'Date.now()' src/auth.ts` on line 3 (the line `asserts` names), commits
it on top of makeWorld's commit before the hub starts, and takes `base` from the new HEAD, the merge base of the stop's
snapshot. The check fails on that base and passes once the turn's edit is in. `on_base: fails` and every assertion are as
they were. Type check: no error in the file. Not run: the test itself.

# Blind redraft: the temp-folder cleanup's time limit (#31, fixture only)

The `afterAll` in `helpers.ts` alone changed. No assertion, expected value, test name, tag, surface in README.md or other line
of the file changed, and what the hook removes is the same.

What changed: the hook that removes the file's temp folders has an explicit timeout of 300 000 ms, in place of Vitest's default
10 s hook limit.

Why: since the redraft of `install`, sample folders hold real copied `node_modules`, and `assertion.test.ts` makes many.
Removing them can outlast 10 s. In the last two proof lane runs the whole file was failed with `Hook timed out in 10000ms`,
though its tests passed.

Not run: any test suite, including the proof lanes. Another job is using this worktree's build, so only the diff was reviewed.

# Blind redraft: AC15's hub test builds deep-hook (#31, fixture only)

`lifetime.test.ts` alone changed, and only in AC15's hub test. No assertion, expected value, test name, tag, the deep CLI
check, the BLOCKED message or `tests/acceptance/29/h-d.ts` changed.

What changed: when `DEEP_HOOK` is missing, the test runs `cargo build -p deep-hook` with cwd `REPO`, both from `h-d.ts`, before
the existing check. The check then decides as before: a failed build, or no cargo, leaves the binary missing and throws the
same BLOCKED. The build may take 600 s, and the test's timeout grew by that much, from 300 s to 900 s.

Why: the proof lanes run tests in a copy of the tracked files with `npm run build` done and no cargo build. `target/` never
exists there, so this test threw BLOCKED every time and could never prove the criterion in a lane.

Proof: with `target/debug/deep-hook` moved aside, the file passed 4 of 4 and the binary was back. Cargo relinked it from
`target/debug/deps` in 0.47 s, same hash and date, with no compile. A compile from nothing into a separate target folder took
8 s. With the binary aside and cargo off `PATH`, and again with a `cargo` that exits 1, the test threw the BLOCKED and the
binary stayed missing.

Not run: the proof lanes themselves, a compile from nothing inside `target/` followed by this test, and the other test files
in this folder.

# Blind redraft: the sample's install (#31, fixture only)

`install` in `helpers.ts` alone changed. No assertion, expected value, test name, tag, line a test reads or the surface in
README.md changed, and sandbox behaviour is untouched.

What changed: `install` no longer clones `node_modules` as one tree. It clones each entry, going one level into `@scope/`
folders, with `cp -cRH` (`-RH` as the fallback): a link named as an entry becomes real files under its own name, and links
below an entry, such as `.bin/*`, stay links, so nothing loops. `@deepbuild/*`, the repo's own workspace packages, stay out:
the sample imports none, and they could only bring in large trees. A plain worktree's sample used to hold them as dangling
relative links; now no layout does. `.bin/` entries that point at them still dangle, as before.

Why: the proof lanes run these tests in a copy whose `node_modules` holds absolute links to a sibling folder, entry by entry
and scope by scope. Cloned as one tree, the sample's `node_modules/vitest` was then a link outside the sample, the real
supervisor's sandbox rightly refused it (`/bin/sh: node_modules/.bin/vitest: Operation not permitted`), and every real Vitest
check failed in the lane though it passed in a plain worktree.

Proof: `install`'s text run on a plain worktree and on a hand-made layout of absolute links, entry by entry and scope by
scope. On each: `node_modules/vitest` is a real folder, no link resolves outside the install, `.bin/vitest` stays
`../vitest/vitest.mjs`, `--version` from an outside folder prints `vitest/5.0.5`, and `node_modules/.bin/vitest run` passes a
test in the sample. Install took 1821 ms and 1815 ms, against 1794 ms for the old clone. `repo-state.test.ts` passes in the
plain worktree (4 of 4).

Not run: the proof lanes themselves, and the other test files in this folder.

# Blind redraft: criterion tags (#31, all 15 criteria)

Tags only. No assertion, fixture, expected value, test's own name or the surface in README.md changed.

What changed: every `describe` in `*.test.ts` carries its AC's tag right after the AC number (`describe('AC1 #31.5a0437de ...')`),
as #30's do, so each test's full name holds it. Each file's header comment names the tags too, and README.md's table has a Tag
column. No line was added or removed in a test file, so no line number a test reads moved. `helpers.ts` has no criterion and
stays untagged.

Why: the tests had no tags, so the proof lanes could not link them to the issue's criteria. Each tag is `criterionId` of
`scripts/proof-change.mjs`, computed by a script with that file's parsing and hash on the real body of issue #31.

## Not run

No test suite ran: names alone changed. The diff was reviewed to confirm it.
