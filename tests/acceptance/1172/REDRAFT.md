# #1172 AC5: blind redraft

Redrafted blind at origin/main 678622403 from the issue, its comments, `docs/technical-design.md` and this folder only.

## Why

The owner decided AC5 on the issue (comment 7071196851, 2026-11-21):

> after Needs you pops out, the main window's page keeps the selected ask's card. The criterion is judged on the list's
> Needs you heading and ask rows leaving the main window and showing in the new window.

The earlier `popout.test.ts` wanted every ask's whole question on the main window's pixels before the press, and no
question anywhere on the main window's tree or pixels after it. Neither follows from the decision: rows may draw their
questions cut short, and the kept card holds its ask's question.

## What each expectation comes from

| Expectation in `popout.test.ts` | From |
|---|---|
| Before the press, the main window's tree has a node named `Needs you` and its pixels draw that heading | Decision: "judged on the list's Needs you heading"; the guard that a reading that sees nothing can't pass |
| Before the press, the main window's tree has a node holding each ask's question, and its pixels draw each question's first 10 letters and digits | Decision: "ask rows"; AC3 ("each Needs you row shows its ask's question") for the tree name; the same guard |
| The press is a person's press (`AXPress`) on `Pop out Needs you` | AC5 "a view pops out"; design: a pop-out needs a gesture serial (canvas-primitives, Window); README dispute 2 |
| A second window opens | AC5 "pops out to its own window" |
| After it, the main window has fewer `Needs you` heading nodes and heading lines than before | Decision: the heading leaves the main window |
| After it, each ask has fewer nodes holding its question in the main tree than before | Decision: the ask rows leave the main window |
| After it, the main tree holds at most one ask's question, and the main pixels draw no question start but that ask's | Decision: the page keeps the selected ask's card, one card |
| The new window's tree and pixels hold the heading and every row, as read before the press | Decision: "showing in the new window"; the guard that a view that merely disappears must fail |

Removed: whole questions on any window's pixels; "no question at all" on the main window after the press. Changed: the
main window is the one window before the press, matched to the tree by frame, instead of the window holding a node named
`Sessions` (#1348 renamed that heading `Tasks` in `helpers.ts` but not here, so the old test could not find it).

## Left as it was

`shellFailures` in `helpers.ts` still reads each ask's whole question off the window's pixels for AC1 and AC2. The
decision is about AC5 only, so it is unchanged here. If whole questions are also cut short on the Mac's first screen,
AC1 and AC2 fail on that reading and need their own decision and redraft. No other test or helper changed.

## Not settled by the issue or the decision

1. How much of a question a row must draw. Here 10 letters and digits, where the fixture's three questions already
   differ; a row that draws fewer can't be read on the pixels, and the test then fails before the press, never passes.
2. Whether a selected card exists at launch. The test presses no row first. Counting each ask's nodes before and after
   holds either way, but a program that opens a card only on the pop-out would fail.
3. Whether something else in the main window, such as a sidebar entry, may also be named or drawn `Needs you`. The test
   wants fewer such nodes and lines after the press, not none.
4. Which pixels a heading is: an OCR line reading `Needs you`, optionally followed by a count.

## Not run

The test needs the Mac (Accessibility, Screen Recording, the real `deep-app`); it was typechecked only.
