# Blind redraft of #1546's two planted-view tests, after #1461

Owner decision, 2026-11-21: blind redraft of `planted record-in-thread-local: ...` and `seed 1546 with the planted view: ...` in
`ac1-journey.test.ts`. Both expected a finding whose view is `deepbuild/needs-you`, and the first also a separate
`deepbuild/sidebar` finding reading "3 asks need you" against "2 asks need you". Since #1461 Needs you is no slot of its own: it
is the list's first section.

Written from issue #1546, issue #1461, the design (`docs/technical-design.md`, `docs/canvas-primitives.md`) and this folder's
existing tests, helpers and README at origin/main `67862240`. No implementation was read: not `crates/deep-replica/src/drive/`,
not PRs #3012 or #3028, not `docs/evidence/`. Every other file here is byte-identical, `helpers.ts` included; the new reading
functions live in `ac1-journey.test.ts` beside the two tests.

## What each test now expects, and where it comes from

### `planted record-in-thread-local: the drawn frame keeps the old count and rows, ...`

It now runs `see`, `feed` (the ask), `see`, one frame. Before, the feed was step 1. Now it is step 2.

| Expectation | Source |
|---|---|
| Before the feed, the drawn frame has both fixture asks' rows and no row for the new ask | #1461 Scope: "The heading Needs you with the one count, then a row per open ask"; README, The fixture (two open asks) |
| After the feed the drawn frame has no row for the ask, and its names equal the frame drawn before the feed. This replaces the literal "2 asks need you" | #1546 problem: "the window keeps its old count ... until you move the pointer". #1461 doesn't settle what the count's node is called, so the test compares with the frame drawn before the feed and pins no wording |
| Step 1, a `see`, passes no frame and is equal | README, `close`'s frames report: "a step that passes no frame, like `see`, is neither" |
| The claim is FAIL. Every finding at step 2 names the call `feed`, and nothing differs before step 2 | #1546 AC1: "fails, naming the view, the node and the step" |
| A finding at step 2 names the view that draws Needs you in the list: `deepbuild/sidebar`, or `deepbuild/needs-you` | #1461 Scope: "The panel names `deepbuild/{sidebar,home,needs-you,session,line}` stay"; #1461 AC7: "A replacement view that passes `needs-you@1` still fills the list's first section"; design table, `deep.registerView`: `needs-you@1` is a kit "with no slot of its own"; README: `view` is "the registered name of the shipped view that draws the node" |
| That finding's node is the ask's row (its name has the question), or the one count reading 3 with the drawn frame's count reading 2. The drawn frame has no row for the ask there | #1461: the heading with the one count comes first, then the rows, oldest first ("a new ask is added under the others"). README: the finding names the view's first differing node in tree order, so in one list view that node may be the count and not the row |

### `seed 1546 with the planted view: FAIL, its first finding at a record event, ...`

| Expectation | Source |
|---|---|
| Unchanged: the same judge fails the planted app, the claim is FAIL, and the first finding is at a `feed` step | #1546 AC1 |
| At some step that raised an ask, a finding names the list's Needs you view (`sidebar` or `needs-you`), and its node is that ask's row or the one count reading the asks open after that step. The count is the fixture's 2, plus each ask raised, less each one cancelled, up to that step | #1461 (as above); #1546 AC1 "naming the view, the node and the step" |

## The wrong programs still fail

- The planted app (`record-in-thread-local`) read as PASS, or with no finding at the feed step: both tests fail.
- A replica whose `see` reads a forced frame: the first test's drawn frame would have the new row and would differ from the
  frame drawn before the feed.
- A replica that names some other view, or a node that is neither the ask's row nor the count at that step: both fail.

## Where the issue didn't settle a value, and what this redraft chose

1. **Which registered view a finding names.** #1461 keeps the name `deepbuild/needs-you` and has a `needs-you@1` view fill the
   list's first section. The design gives that kit no slot of its own. So the section may be drawn by the sidebar's view
   or by a registered needs-you view inside it. Both names are accepted, matched by their last segment, as the README already
   matches views.
2. **What the count's node is called.** #1461 says only "the heading Needs you with the one count". Whether "N asks need
   you" survives isn't settled, so no wording is pinned. The count is read as a whole number in the node's name or value. In
   the first test it is 3 in the forced frame and 2 in the drawn one. In the journey it is the computed open-ask count,
   absent from the drawn node. A node whose name has a `?` is treated as an ask's row and never as the count.
3. **One finding or two.** If one view draws both the count and the rows, the README's rule gives one finding per step and
   view, so the separate sidebar finding with the count is no longer required.

## Not run

Only `tsc --noEmit -p tests/acceptance/1546/tsconfig.json` was run, and it passed. The replica tests need a Mac and weren't run
here, so neither redrafted test has yet been seen to fail on the planted app or to pass on the fix.
