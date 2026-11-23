# #1172 AC5: blind redraft

Redrafted blind at origin/main 678622403 from the issue, its comments, `docs/technical-design.md` and this folder only.
Second redraft (2026-11-22), of the first one at 7c8d9a28d, for two disputes a review raised against it.

## Why

The owner decided AC5 on the issue (comment 7071196851, 2026-11-21):

> after Needs you pops out, the main window's page keeps the selected ask's card. The criterion is judged on the list's
> Needs you heading and ask rows leaving the main window and showing in the new window.

The original `popout.test.ts` wanted no question anywhere on the main window's tree or pixels after the press, which the
kept card contradicts. The first redraft fixed that, and the review found two faults in it:

1. **Cut-short questions passed.** A row counted as drawn when its question's first 10 letters and digits were on the
   pixels. No source lets a row draw its question cut short: AC3 reads "Each Needs you row shows its ask's question", and
   the decision says nothing of it. Now presence (before the press, and in the popped window) needs one pixel line holding
   the whole question, read with `reads` from `helpers.ts`, as `shellFailures` already reads AC1's rows.
2. **A row that stayed could pass.** "Fewer nodes holding the question than before" let a program that closes an open card
   but keeps the row drop 2 → 1 and pass. Now the test fixes which card is open, and measures what the card adds:
   - At launch it reads the list and picks an ask with none of its options on the main tree (the selected ask), so its
     count of nodes holding its question is its rows' alone.
   - It presses that ask's row, as AC3 does ("a click on it presents that ask's question card in the window"), checks that
     its card is open and no other ask's is, and reads again. The difference is the card's share of the question.
   - After the pop-out, the selected ask may hold at most its card's share, and only while its card is still open; every
     other ask, and the selected one once its card is gone, may hold nothing. So a row that stays fails, whatever card is
     open.

   A card is told by its own options, both as `AXButton`s: README, Pinned item 2 ("the presented card's option rows as
   `#327` draws them: `AXButton`s whose names hold the option's label") and AC3's judge in `rows.test.ts`, which reads a
   card by its options "since the question alone is already on the row under it". No source gives a row a mark a card's
   question node can't also have (both are named with the question, README item 2 and AC3), so the test tells them apart
   by count against a known state, not by node. Making the start hold no card at all was the other choice; it was not
   taken because the decision speaks of a selected ask's card, so a right program may keep one open, and the test would
   then have nothing to say about the card the decision names.

## What each expectation comes from

| Expectation in `popout.test.ts` | From |
|---|---|
| At launch the main window has one window, a node named `Needs you`, that heading on its pixels, a node holding each ask's question, and one pixel line holding each whole question | Decision: "judged on the list's Needs you heading and ask rows"; AC3 "Each Needs you row shows its ask's question"; README item 2 (a row's name holds its question); the guard that a reading that sees nothing can't pass |
| One ask has none of its options on the main tree at launch, or the run is `BLOCKED` | Needed to read a row apart from a card (dispute 2); invariant 2: an unreadable start never passes |
| A press on that ask's row opens its card (both options `AXButton`s, both on the pixels) and no other ask's card, in the same window, and leaves the list whole | AC3 ("a click on it presents that ask's question card in the window"); README item 2; `rows.test.ts`'s card judge; the decision's "selected ask" |
| The press on `Pop out Needs you` is a person's press (`AXPress`) | AC5 "a view pops out"; design: a pop-out needs a gesture serial (canvas-primitives, Window); README item 2 and dispute 2 |
| A second window opens | AC5 "pops out to its own window" |
| After it, the main window has fewer `Needs you` heading nodes and heading lines than before | Decision: the heading leaves the main window |
| After it, the selected ask holds on the main tree at most its card's share of nodes, and on the pixels at most its card's share of lines starting its question, while its card is open; else none | Decision: the rows leave, the selected ask's card stays; dispute 2 |
| After it, every other ask holds no node with its question and draws no line starting it on the main window | Decision: the rows leave; only the selected ask has a card (checked before the press) |
| The new window's tree and pixels hold the heading and every row, each whole question on one pixel line | Decision: "showing in the new window"; AC3's wording; the guard that a view that merely disappears must fail |

**Which wrong programs fail now.** A row kept with its card closed: the card's options are gone, so the ask may hold
nothing, and the row's node fails. A row kept with the card open: the row's node is over the card's share. A row drawn
cut short before or after the pop-out: no line holds its whole question. A view that vanishes: the popped window lacks it.
A window opened with the view still in the main one: the heading and rows stay.

Removed: the first redraft's "a row is drawn when its first 10 letters and digits are"; "fewer nodes than before" for
each ask; "at most one ask's question on the main tree", now implied by the per-ask rule. Kept: leaving is judged on the
pixels by a question's first 10 letters and digits (any line holding them counts as still drawn), stricter than the
whole question. Changed earlier and kept: the main window is the one window before the press, matched to the tree by
frame, instead of the window holding a node named `Sessions` (#1348 renamed that heading `Tasks` in `helpers.ts`).

## Left as it was

`shellFailures` in `helpers.ts` reads each ask's whole question off the window's pixels for AC1 and AC2, as this test
now does. No other test or helper changed.

## Not settled by the issue or the decision

1. Whether the card keeps the same share of its question after the pop-out. The test lets the card hold as many nodes and
   lines with its question as it did before; a program that drops one of the card's and keeps the row at the same total
   would pass. No source fixes how many times a card names its question.
2. Whether a card may be open at launch. Allowed, if at least one ask has none of its card open; if every ask's is, the
   run is `BLOCKED`, never a pass.
3. Whether something else in the main window, such as a sidebar entry, may also be named or drawn `Needs you`. The test
   wants fewer such nodes and lines after the press, not none.
4. Which pixels a heading is: an OCR line reading `Needs you`, optionally followed by a count.
5. Whether the kept card must stay. The decision says the page keeps it, and judges AC5 on the heading and rows only, so
   the test allows a card that stays and one that closes; a closed card leaves its ask nothing on the main window.
6. That a whole question fits one pixel line at the reference window. A row that wraps its question fails, as AC1's
   reading would.

## Not run

The test needs the Mac (Accessibility, Screen Recording, the real `deep-app`); it was typechecked only.
