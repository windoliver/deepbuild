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
