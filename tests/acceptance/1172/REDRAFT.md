# #1172 AC5: blind redraft

Redrafted blind at origin/main 678622403 from the issue, its comments, `docs/technical-design.md` and this folder only.
Second redraft (2026-11-22), of the first one at 7c8d9a28d, for two disputes a review raised against it.
Third redraft (2026-11-23), of the second at a6bcb6351, for a dispute from a Mac run (below, Third redraft).
Fourth redraft (2026-11-23), of the third at 0560a1718, for a dispute from a Mac run on AC1's and AC2's row count (below, Fourth redraft).
Fifth redraft (2026-11-24), of the fourth at c6bdfac2f, for a review's dispute that AC5's after-reading could see nothing (below, Fifth redraft).
Sixth redraft (2026-11-25), of the fifth at 766efa508, for a dispute from a Mac run on AC2's answered row (below, Sixth redraft).
Seventh redraft (2026-11-25), of the sixth at 3e7cd3fea, for a review's dispute that a right page fails the sixth (below, Seventh redraft).
Eighth redraft (2026-11-25), of the seventh at 78c912ece, for a review's dispute on the word's case (below, Eighth redraft).

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
| AC1, AC2: `shell.test.ts` calls a new `shellFailuresCut`, `shellFailures` with one change: a wanted row is drawn when `drawsRow`, an unwanted one (AC2's answered ask) when neither its whole question nor a cut row of it is on a line. `shellFailures` itself is left as it was | As above. In scope: the dispute names it, it is this blind job's helper, and the same measurement (same fixture, list and reference window) shows it demands the same forbidden whole line, so a right program fails AC1 at its first reading |
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
4. AC1's other readings in `shellFailuresCut` (copied from `shellFailures`) were not revisited: only the row's pixels were
   in dispute.

### The guard's constraint

A first build of this redraft (af769a051, never pushed) changed a line of `shellFailures` in `helpers.ts`. The guard failed
it: other issues' tests read `helpers.ts`, and a looser tolerance lands only as a new case beside the old. So `helpers.ts`
now changes by added lines only: `ROW_START`, `drawsRow` and `shellFailuresCut` are appended, and no existing line,
`shellFailures` included, changes. `shell.test.ts`, which only #1172's tests read, switches its calls to
`shellFailuresCut`. `shellFailuresCut` copies `shellFailures` instead of calling into it, because the row reading sits
inside its loop. The copy is the cost of changing no existing line.

## Not run

The Mac tests need the Mac (Accessibility, Screen Recording, the real `deep-app`); they were typechecked only
(`npx tsc -p tests/acceptance/1172/tsconfig.json`, clean). `judges.test.ts` ran here (16 passed), after
`node packages/evidence/build-patterns.mjs`, which writes the `dist/patterns.json` the suite's imports need.

## Fourth redraft (2026-11-23)

Redrafted blind at 0560a1718 from the issue, its comments, `docs/technical-design.md` and this folder only; no
implementation code and no PR was read.

### The dispute

A Mac run at e1468a920 with this folder at 0560a1718 failed AC1's main test and AC2 (before its answer) on `Needs you should
show 1 row for ask:… ("Which header colour on the login page?"); it has 2`. The run's own probe, 15 s after launch, read
one window: three sidebar rows, each an `AXButton` named with its question and holding it, its kind and its time; and on
the session page an `AXGroup` named `armed` holding the first ask's kind, its question, `Blue header` and `Green header` as
`AXButton`s, its default and "Answering saves it for this task". The other two asks appeared only in their rows. So the 2
is the first ask's row plus its open card's question. `shellFailures` and `shellFailuresCut` count every outermost node
holding a question across the window and want exactly 1, so a card on the page counts as a second row.

The design puts that card there: Needs-you view, "One list and one page": "The page shows what's selected: an ask's
question card, …" and "The window opens on the first open ask". The owner decision of 2026-11-21 (above) says the main
window's page keeps the selected ask's card. So a right program fails the third redraft's AC1 reading at launch.

### What changed

| Change | Source |
|---|---|
| A node holding an ask's question is that ask's card's when the nearest node at or above it holding both the ask's options as `AXButton`s holds no other ask's question (`askNodes`). Every other such node is a row | A card is told by its two options as `AXButton`s: README, Pinned item 2; AC3's judge in `rows.test.ts`; `cardOpen` in `popout.test.ts`. "Holds no other ask's question" keeps the list itself, which holds every row, from reading as a card: the design's card is on the page, apart from the list ("One list and one page") |
| A wanted ask has exactly 1 row outside its card. Its card is not counted (`askRowFailures`) | AC1 "Needs you with 3 rows"; design: "a row per open ask"; the decision's kept card |
| While a wanted ask's options are on the tree as `AXButton`s, at least one node holding its question must sit in its card, or the reading fails as unable to tell row from card | Invariant 2: a reading that can't tell a row from a card never passes. Without it, a card laid flat beside the list with its row gone would read as the one row |
| An unwanted ask (AC2's answered one) has no row **and no card** on the tree | AC2: "makes the window … read 2"; design, "An item leaves Needs you only on your answer" and "an answer clears it everywhere" (States people see); invariant 4, "never the same question twice": an answered ask's card still offering its options would put the question to you again. The design's receipt is "the answered card's receipt" (Asks), for an answer made on the card; here the answer comes from `deep inbox answer`, which the design gives no receipt in the window |
| `shellFailuresCard` in `helpers.ts`: `shellFailuresCut` with its per-ask tree count replaced by `askRowFailures`. Everything else, the pixel reading (`drawsRow`) and the menu bar's reading included, is `shellFailuresCut`'s own, unchanged | The dispute is the tree's row count only; the menu reading is a separate finding still being diagnosed and is left as it was |
| `shell.test.ts` calls `shellFailuresCard` where it called `shellFailuresCut` (AC1's main test, its spike plant, its proof test's settle, AC2 before and after the answer) | As the third redraft did |
| `judges.test.ts`: 12 cases of `askRowFailures` on built trees, no app | AGENTS.md, Proof: a judge must fail a wrong program; these run anywhere |

AC2's timing loop is unchanged: it stops the clock when the menu bar reads 2 and no node holds the answered ask's
question. That matches the rule above, that an answered ask keeps neither row nor card.

### Which wrong programs fail (pinned in `judges.test.ts`)

Controls that pass: the disputed launch reading (three rows and the first ask's card, which the old reading counted 2);
three rows and no card; after the first ask is answered, two rows and the next ask's card; a card named with its question
that holds its options.

Wrong programs that fail, naming the ask:
- two rows for one ask beside its card;
- a wanted ask whose card stays but whose row is gone (0 rows outside its card);
- a "card" whose options are `AXStaticText`, not buttons: no card, so its question counts as a second row;
- a group holding the question and no options: no card, a second row;
- a card's question and options laid flat beside the list with the ask's row gone: the row can't be told from the card;
- an answered ask whose row stays;
- an answered ask whose card stays with its options, its row gone;
- a "card" that also holds another ask's question: not apart from the list, so a second row.

### Still not settled

1. **An answered ask's card.** The rule wants none on the tree. A right program that keeps a receipt naming the answered
   question on the page would fail AC2. The design gives a receipt to an answer made on the card, and is silent on an
   answer made elsewhere while the card shows; this redraft took the strict reading from AC2's "read 2", invariant 4 and
   "an answer clears it everywhere". The pixel reading agrees: `drawsRow` reads the whole question on a receipt's line, so
   a kept receipt fails there too.
2. **A row holding both its options as `AXButton`s** (row controls that "show on hover and selection and stay in the
   tree", design) would read as a card, leaving its ask 0 rows. No source gives a row its options; the probe's rows hold
   none. A false failure, never a false pass.
3. **A flat tree.** A card whose question and options are not under a node of their own, apart from the list, fails
   (as unable to tell row from card). The probe's card is its own `AXGroup`.
4. **The pixels.** With a card open, the card's line holds the whole question, so `drawsRow` passes a wanted ask on the
   pixels whether or not its row is drawn. The tree reading still fails a missing row; the pixels alone don't. Telling a
   row's line from a card's on the pixels would need frames matched between the tree and the capture, which no source
   pins. Left as the third redraft had it.
5. **The menu bar's `[]`.** Not revisited (the dispute's separate finding).

### The guard's constraint

As in the third redraft: `helpers.ts` changes by added lines only. `askNodes`, `askRowFailures` and `shellFailuresCard`
(with two private helpers) are appended after `shellFailuresCut`; no existing line, `shellFailures` and `shellFailuresCut`
included, changes. `shellFailuresCard` copies `shellFailuresCut` instead of calling it, since the row count sits inside its
loop. `shell.test.ts`, which only #1172's tests read, switches its calls.

### Run here (Linux, no Mac)

`node node_modules/vitest/vitest.mjs run --root tests/acceptance/1172 judges`: 1 file, 28 passed (16 before, 12 new).
`npx tsc -p tests/acceptance/1172/tsconfig.json`: clean. The Mac tests (`shell.test.ts` AC1, AC2) were not run.

## Fifth redraft (2026-11-24)

Redrafted blind at c6bdfac2f from the issue, its comments, `docs/technical-design.md` and this folder only; no
implementation code and no PR was read.

### The dispute

An independent review of the fourth redraft: in `popout.test.ts`, step 3's reading of the main window after the pop-out
checked only absences, fewer `Needs you` heading nodes and lines than before, and each ask's question at or under its
card's share. Nothing required that the reading saw the main window at all. So a program whose main window goes blank on
pop-out passed AC5, and so did one capture or tree read taken mid-relayout that came back empty, since `settled` stops at
the first passing reading. That breaks invariant 2: a reading that sees nothing never passes. The original blind test
located the main window by a node it still required (`Sessions`); the second redraft matched the window by frame instead,
and the anchor went with it.

### What changed

| Change | Source |
|---|---|
| `keeps` in `popout.test.ts`: for each fixture session, the main window's tree holds an `AXButton` whose name holds its task's title, and one pixel line holds that title | Design, Needs-you view, "One list and one page": the list holds the Needs you heading and its rows, "then a heading per project with its session rows"; only Needs you pops out (AC5, the decision: the criterion is "the list's Needs you heading and ask rows leaving"). README, Pinned item 2: "each sidebar row an `AXButton` (role `Button`) whose name holds its task's title"; AC1 reads the same rows (`shellFailuresCard`). The titles (`Cart totals`, `Release notes`) are short enough to sit whole on a row, unlike the questions (third redraft) |
| Step 3's reading (`left`) starts from `keeps`, so it fails unless it sees the session rows on the tree and the pixels | Invariant 2; the dispute |
| Step 2's reading (`unready`) also requires `keeps`, so the before and after readings require the same thing | "The same reading saw them before the press" (README, AC5 row): a right program that fails `keeps` fails before the pop-out, not as a pop-out fault |

No helper changed: `keeps` is local to `popout.test.ts` and uses `helpers.ts`'s existing `nodes`, `reads`, `sees` and type
`FixtureSession`. No judge case was added: `keeps` reads an app, and the dispute's wrong input (an empty tree, no OCR lines)
fails it on its face, one failure per session per surface.

### Which wrong programs now fail

- A main window that goes blank, or loses the list, on pop-out: no session row on the tree or the pixels.
- A transient empty reading (empty tree or no OCR lines) after the pop-out: it fails, so `settled` keeps reading until a
  reading that sees the session rows also shows the heading and rows gone.
- A pop-out that takes the whole list, session rows included, out of the main window.

A right program still passes: the decision lets the selected ask's card stay, which `keeps` doesn't read, and the session
rows stay in the list.

### Not settled

1. **The `Tasks` heading.** AC1's helpers require a node named `Tasks` (#1348's rename, second redraft); `keeps` does not,
   since the design names only "a heading per project", and the session rows already anchor the reading.
2. **Folded sessions.** The design folds quiet sessions into one row per project. The fixture's sessions both hold open asks,
   and AC1 already wants both as rows; a right program that folds them once their asks leave Needs you would fail `keeps`.
   No source says popping the view out makes a session quiet.
3. **The page.** The kept card is still not required (item 5 above); the anchor is the list's session rows, not the page.

### Run here (Linux, no Mac)

`npx vitest run tests/acceptance/1172/judges.test.ts`: 1 file, 28 passed (unchanged). `npx tsc -p
tests/acceptance/1172/tsconfig.json --noEmit`: clean. `node scripts/repo-rules.mjs`: exit 0. `popout.test.ts` was not run
(it needs the Mac).

## Sixth redraft (2026-11-25)

Redrafted blind at 766efa508 from #1172 and its comments, `docs/technical-design.md`, #1461's and #1807's issue text and
this folder only; no implementation code and no PR was read.

### The dispute

A Mac run (main 1b4929ae7 with this folder at 766efa508, 2026-11-25) passed AC1 and failed AC2 after the answer, with the
menu bar already reading 2: `Needs you should show 0 rows for ask:… ("Which header colour on the login page?"); it has 1`,
and the pixels still drew a line holding the question followed by `Answered "Blue header" at 12:12 from deep inbox. Nothing
is left to answe…`. The disputing party says the program keeps a row that left the list in its slot, drawn answered, until
2 s after the person has also left the list, and attributes the rule to #1461. AC2's reading (fourth redraft) wanted the
answered ask to hold no node and no line at all, and its timing loop stopped the clock only then.

### Ruling: A, the expectation was wrong for this state

The design's "One list and one page" (Keymap, placement, window) names the window #1461 built, and #1461's scope says
"Suites that pin the old shape go through their blind redraft". #1461 settles exactly this state:

- "A row that left its state keeps its slot while the pointer is over the list or focus is in it, and for 2 s after both
  have left." (When rows move, one rule)
- Its AC: "With focus in the list, an ask answered from `deep` keeps its row in place, drawn answered, until focus and
  pointer have been out of the list for 2 s." AC2 answers through `deep inbox answer`.
- "A new state shows in place at once: its mark, its word and the count never wait." So the window reads 2 at once
  through the count and the row's word, while the row keeps its slot.

#1807 (open) agrees: "An answered ask's row keeps its place, drawn answered … Its state word is the receipt
("Answered", …) … The one count drops at the answer." The design's "a row per open ask", "An item leaves Needs you only on
your answer" and "an answer clears it everywhere" say the ask stops counting and stops needing you; #1461 is the later,
more specific word on how its row leaves. So AC2 (#1172's "the window … read 2") is read as: two open rows and the count
2, and the answered ask at most kept as one row drawn answered, offering nothing.

The test can't hold the list unattended to wait out the hold: no source names a surface that moves focus and the pointer
out of the list without also selecting something, so that branch was not taken.

### What changed

| Change | Source |
|---|---|
| `answeredRowFailures` (tree, one answered ask): at most one row outside a card; that row reads answered (a node at or under it whose name matches `answered`, not `not answered`); no card, and its two options nowhere on the tree as `AXButton`s | #1461 "keeps its slot", "drawn answered"; #1807's state word "Answered"; invariant 4 (the question never put to you again); the card told by its options, as before |
| `askRowFailuresAnswered`: `askRowFailures`' wanted branch, unchanged, for the open asks; `answeredRowFailures` for the rest | As above |
| `answeredLineFailures` (pixels): at most one line draws the answered ask's row (`drawsRow`), and that line reads answered | As above; one row is one line (design) |
| `shellFailuresAnswered`: `shellFailuresCard` with those two in place of wanting the answered ask gone; everything else, the count and the menu bar included, is its own | The dispute is the answered row only |
| `shell.test.ts` AC2: the timing loop stops the clock when the menu bar reads 2 and `answeredRowFailures` is empty; the after-reading calls `shellFailuresAnswered`. AC2's reading before the answer, and AC1, still call `shellFailuresCard` | #1461 "its mark, its word and the count never wait", so the 1 s still holds for the row's word |
| `judges.test.ts`: 10 cases (5 controls, 7 wrong inputs across them) | AGENTS.md, Proof |

`helpers.ts` changes by added lines only, as before; `shellFailuresAnswered` copies `shellFailuresCard` for the same reason
`shellFailuresCard` copied `shellFailuresCut`.

### Which wrong programs fail (pinned in `judges.test.ts`)

Controls that pass: the answered row kept, drawn answered, beside the two open rows and the next card; the answered row
gone; the disputed Mac run's pixel line; a cut row with `Answered` on its line.

Wrong programs that fail: the answered ask kept as a still-open row (its kind word, no `Answered`), on the tree and on the
pixels; a row that reads "Not answered"; two kept rows for the answered ask; its card still offering its options with its
row drawn answered; the answered question on two lines; a wanted ask's row gone beside a kept answered row.

### Still not settled

1. **The row must go eventually.** The test doesn't hold the list unattended, so a program that keeps the answered row
   forever, drawn answered, passes AC2. #1461's own AC ("until focus and pointer have been out of the list for 2 s") is
   where that is judged.
2. **A kept row plus a page receipt.** At most one node and one line may hold the answered question. #1807 (open) keeps a
   receipt on the page only after the last ask, which AC2's state isn't, so a right program has one; a program drawing
   both would fail, naming the count.
3. **What "drawn answered" reads.** The word `answered` anywhere in the row's nodes or line. #1461 gives no word; #1807
   gives "Answered" among others ("Starts in 8 s", "Allowed · ran"), which apply to holds and approvals, not to AC2's
   pick-one ask. A right row worded otherwise fails, naming what it holds.
4. **The menu bar's reading.** Not revisited.

### Run here (Linux, no Mac)

`npx vitest run --root tests/acceptance/1172 judges`: 1 file, 38 passed (28 before, 10 new). `npx tsc -p
tests/acceptance/1172/tsconfig.json --noEmit`: clean. `shell.test.ts` AC2 was not run (it needs the Mac).

## Seventh redraft (2026-11-25)

Redrafted blind on 311cd158b (the sixth, 3e7cd3fea, with main merged) from the same sources as the sixth; no
implementation code and no PR was read.

### The dispute

An independent review of the sixth: the disputed Mac line, the whole question then `Answered "Blue header" at 12:12 from
deep inbox. Nothing is left to answe…`, is the page, the answered ask's closed card, not the list row; on the Mac a list
row OCRs cut with its state word (`• Which header co... How it looks`, third redraft). A closed card has no option
`AXButton`s, so `askNodes` counts its question as a row. A right program that keeps the list row drawn answered (#1461)
while the page shows the closed card has 2 nodes and 2 lines, and fails the sixth's judges; its timing loop never stops.
The sixth's "Still not settled 2" assumed only one of the two shows, which the capture contradicts: the page drew the
receipt with two asks still open. The review also found the word match too loose ("not yet answered", "isn't answered",
"to be answered", "Not  answered" read as answered).

### Ruling: the page may say the ask was answered

- Design, Keymap, placement, window, Address: "an address that no longer resolves says what it was and what became of
  it". The page was on `ask/<id>` (the window "opens on the first open ask", and AC2 answers that ask); after an answer
  from elsewhere the page may stay there and say the ask was answered.
- #1807 (open): "The page moves to the next ask at once, except while a hold counts down on the card you just answered";
  this speaks of an answer made on the card. #1461's "Answering an ask selects the next one" likewise. Neither says an
  answer from `deep` moves the page, and #1461's "Nothing moves under the pointer" and the design's "opens and never
  answers" leave selection to the person. So the closed card on the page is allowed, not required; the page may also
  move on.
- The list row: #1461 as in the sixth ("keeps its slot", "drawn answered").

So the answered ask may hold at most one node in the list and one on the page, each reading answered, and nothing that
offers its options.

### Telling the list from the page

The design's window "has two regions", the list and the page, and #1461 puts "the list on the left … and the page on the
right". README item 2 makes each session row an `AXButton` whose name holds its task's title; those rows are the list's.
So `listEdge` is the session rows' right edge on the tree (screen points), and a node whose frame's centre is left of it is
the list's; on the pixels the edge is mapped into the capture by the main window's frame (`probe windows` and the probe's
tree share screen points; the capture is the window at its backing scale). No session row: `can't tell the list from the
page`, a failure, never a pass (invariant 2).

### What changed

| Change | Source |
|---|---|
| `ANSWERED_WORD`: the state word `Answered`, capitalised, not after `not`, `n't`, `yet`, `be` or `never` and any spaces; `unanswered` has no word start | #1807 "Its state word is the receipt ("Answered", …)"; the Mac capture's `Answered "Blue header"`; the review's examples |
| `answeredFailures` (tree): at most one node holding the question in the list and at most one on the page; each reads `Answered` in it or in the nearest nodes above it that hold no other ask's question (the closed card's question and its receipt sit side by side; the list stops the climb); the ask's two options nowhere as `AXButton`s | Above; invariant 4 |
| `answeredListLineFailures` (pixels): of the lines left of the list's edge, at most one draws the answered row (`drawsRow`), and it reads `Answered`. Page lines are left to the tree: a closed card may draw its question and its receipt on separate lines | Above; the design's row is one line |
| `askRowFailuresKept`, `shellFailuresKept`: as the sixth's `askRowFailuresAnswered` and `shellFailuresAnswered`, with these judges. `shell.test.ts` AC2's timing loop and after-reading call them | As the sixth |
| The sixth's `answeredRowFailures`, `askRowFailuresAnswered`, `answeredLineFailures`, `shellFailuresAnswered` and their 10 judge cases are removed: nothing calls them now. Against main, `helpers.ts` still changes by added lines only | AGENTS.md: delete additions left without a caller |
| `judges.test.ts`: 18 cases | AGENTS.md, Proof |

### Which wrong programs fail (pinned in `judges.test.ts`)

Controls that pass: the list row drawn answered plus the page's closed card saying it was answered (the review's right
program); the page alone saying so; neither; on the pixels, the cut row drawn answered beside the page's receipt line.

Wrong programs that fail: a still-open list row (its kind word), even beside a page that says answered, on the tree and on
the pixels; two list rows drawn answered; the card still offering its options on the page; the page showing the question
with no word of the answer; a row reading `Unanswered`, `Not answered`, `Not  Answered`, `not yet Answered`,
`isn't Answered`, `to be Answered` or `never Answered`; a list line reading `Not answered`; two list lines; a tree with no
session row (can't tell list from page).

### Still not settled

1. **The row must go eventually** (sixth, item 1): still judged only by #1461's own AC.
2. **The list's edge.** Read from the session rows' frames; a program whose session rows don't span the list, or whose
   page starts left of their right edge, could misplace a node. OCR merging a list line with a page line on the same
   baseline would put the merged line by its centre; Vision reads the two regions apart in the third redraft's captures.
3. **What the page says.** Only that something near the question reads `Answered`. #1807's other receipts ("Starts in
   8 s", "Allowed · ran") are for holds and approvals, not AC2's pick-one ask.
4. **The menu bar's reading.** Not revisited.

### Run here (Linux, no Mac)

`npx vitest run --root tests/acceptance/1172 judges`: 1 file, 46 passed (28 from before the sixth, 18 new). `npx tsc -p
tests/acceptance/1172/tsconfig.json --noEmit`: clean. `shell.test.ts` AC2 was not run (it needs the Mac).

## Eighth redraft (2026-11-25)

Redrafted blind on 78c912ece from the same sources; no implementation code and no PR was read.

### The dispute

A review of the seventh: `ANSWERED_WORD` matched only a capital `Answered`. The capital in the Mac capture is the page's
receipt sentence (`Answered "Blue header" at 12:12 …`); the disputing party says the kept list row's state word is lower
case, `answered`. A right row would read as still open, the timing loop would never stop, and AC2 would fail.

### Ruling

Upheld. #1461, the governing source, says only "drawn answered" and gives no case; #1807, which spells "Answered", is
open and names the receipt, not a fixed spelling. So the case was the seventh's own addition, unsupported.

### What changed

| Change | Source |
|---|---|
| `ANSWERED_WORD` matches `answered` in any case; the negation guard stays (`not`, `n't`, `yet`, `be`, `never`, then any spaces, any case), and `unanswered` still has no word start | #1461 "drawn answered" |
| `judges.test.ts`: a control, a list row whose state word is a lower-case `answered` beside the page's closed card, on the tree and on the pixels; the wrong-word cases add `unanswered`, `not yet answered`, `isn't answered`, `to be answered` in lower case; the pixel case also fails `unanswered` and `not yet answered` | AGENTS.md, Proof |

Every other expectation and wrong program of the seventh stands.

### Still not settled

1. As the seventh, items 1 to 4.
2. **A flat row.** If a row's question and its state word were sibling nodes directly under the list, the climb for the
   word stops at the list (it holds other asks' questions) and the row reads as open. The probe's rows are `AXButton`s
   holding both (fourth redraft), and no source lays a row out flat, so this was left.

### Run here (Linux, no Mac)

`npx vitest run --root tests/acceptance/1172 judges`: 1 file, 51 passed (46 before, 5 new). `npx tsc -p tests/acceptance/1172/tsconfig.json
--noEmit`: clean. `shell.test.ts` AC2 was not run (it needs the Mac).
