# #1172 AC5: blind redraft

Redrafted blind at origin/main 678622403 from the issue, its comments, `docs/technical-design.md` and this folder only.
Second redraft (2026-11-22), of the first one at 7c8d9a28d, for two disputes a review raised against it.
Third redraft (2026-11-23), of the second at a6bcb6351, for a dispute from a Mac run (below, Third redraft).

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

## Left as it was (second redraft)

`shellFailures` in `helpers.ts` reads each ask's whole question off the window's pixels for AC1 and AC2, as this test
now does. No other test or helper changed. The third redraft changed this; see below.

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
6. Settled by the third redraft: a row's title may be cut by an ellipsis on the pixels (below). Still assumed: a row draws
   on one pixel line, so a row that wraps its question fails.

## Third redraft (2026-11-23)

### The dispute

A Mac run at the fix's head reached `popout.test.ts` step 1 and failed there: the reading wanted one OCR line holding each
ask's whole question in the main window, and the list drew `Which header co... How it looks`, `Which font for th... How it
looks` and `Which layout for... How it looks`: each title cut by an ellipsis, then the ask's state word. The dispute
measured the fixture's text in the look's body font (Inter, 13 px): the questions are 244.6, 211.6 and 199.1 px regular
(249.2, 216.7, 203.9 semibold), and `How it looks` 75.5 px. The list is the look's `shell.sidebar`, 260 px (the suite's
own `world.json` puts the session page at x = 260), and its row has padding, a mark and the gap after it before the title
(the row of #1461, as the dispute gives it: 8 px each side, a 16 px mark and 8 px after it), so a title has at most about
220 px even with no state word or time. The first question can't sit whole on one line of the list under the design, so
item 6 below (an assumption the second redraft named) was wrong, and the reading demanded what the design forbids.

### What changed

| Change | Source |
|---|---|
| A row is drawn on the pixels when one line holds its whole question, **or** its question's start, at least its first 10 letters and digits (`ROW_START`), followed on that line by an ellipsis (`…`, or two or more dots as OCR reads one). `drawsRow` in `helpers.ts`; it replaces `reads(lines, question)` for rows only | Design, Needs-you view, "One list and one page": "A row is one line with fixed slots (mark, title, then state word and time at the right edge)" and "Text cut from the screen stays in the accessible name"; the look: `shell.sidebar` 260, `type.body` 13 px, `fonts.body` Inter; canvas-primitives, Text: `overflow: mask \| ellipsis = ellipsis`; the row of #1461 as the dispute quotes it (a title past the row's width ends in an ellipsis) |
| The floor of 10 letters and digits is `popout.test.ts`'s old `START`, now one constant for both presence and leaving | The second redraft's leaving reading: a line holding a question's first 10 letters and digits counts as still drawn. With one floor, a row seen at launch is one the leaving reading can see; a lower floor would let a row kept cut shorter than 10 pass the leaving reading. 10 is within what the dispute's run drew (13, 14 and 14) |
| `popout.test.ts`: at launch, before the pop-out and in the popped window, each row is judged with `drawsRow` (`Seen.drawn`, was `whole`) | As above |
| `shellFailures` (AC1, AC2): a wanted row is drawn when `drawsRow`; an unwanted one (AC2's answered ask) when neither its whole question nor a cut row of it is on a line | As above. In scope: the dispute names it, it is this blind job's helper, and the same measurement (same fixture, list and reference window) shows it demands the same forbidden whole line, so a right program fails AC1 at its first reading |
| `judges.test.ts`: `drawsRow` on read lines, no app: passes the whole question, the dispute's own reading and a `…` cut; fails a handle, the ask's kind alone, another ask's cut question, a title clipped with no ellipsis, a cut under 10 letters and digits, and an ellipsis after text that isn't the question's start | AGENTS.md, Proof: a judge must fail a wrong program; this one runs anywhere, so the judge's own errors don't wait for the Mac |

Unchanged and still strict: on the tree every row is a node named with its **whole** question (README item 2; AC3; the
design's "Text cut from the screen stays in the accessible name"); the heading; which card is open; the card's share; the
leaving reading (no line holding a question's first 10 letters and digits beyond the card's share); the popped window's
tree and pixels.

### Which wrong programs fail

- A row kept beside an open card: its tree node is over the card's share (unchanged).
- A row kept with the card closed: the ask may hold nothing; its node and its cut line, which holds the first 10 letters
  and digits, both fail (unchanged; the floor is now shared, so the row seen at launch is the one looked for after).
- A view that vanishes: the popped window has no heading, no row nodes and no drawn rows.
- A view left in the main window with a second window opened: the heading and rows stay.
- A row that shows the ask's handle, its kind alone, another ask's question or text that isn't its question's start: no
  line draws it, and no node is named with its question (`judges.test.ts` pins the pixel half without the Mac).
- A row whose question is cut with no ellipsis, or cut before its first 10 letters and digits: fails the pixel reading.

### Still not settled

1. The floor of 10 letters and digits. No source gives a least visible title; a right program whose state word and time
   leave a title under 10 letters and digits at 260 px would fail. The dispute's run drew 13 to 14.
2. That OCR reads the ellipsis: as `…` or as two or more dots. A right row whose ellipsis OCR drops fails, and says so with
   the lines it read.
3. A row drawn on one line: a wrapped title still fails (item 6 above).
4. AC1's other readings in `shellFailures` were not revisited: only the row's pixels were in dispute.

## Not run

The Mac tests need the Mac (Accessibility, Screen Recording, the real `deep-app`); they were typechecked only
(`npx tsc -p tests/acceptance/1172/tsconfig.json`, clean). `judges.test.ts` ran here (16 passed), after
`node packages/evidence/build-patterns.mjs`, which writes the `dist/patterns.json` the suite's imports need.
