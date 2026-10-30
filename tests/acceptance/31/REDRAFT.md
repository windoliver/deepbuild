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
