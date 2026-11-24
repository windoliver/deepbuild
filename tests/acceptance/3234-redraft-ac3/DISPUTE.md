# Dispute: #3234 AC3 and AC4's first draft types the words on the card, which #1462 AC8 forbids

This redraft exists because of this dispute. The first draft is `tests/acceptance/3234/answer.test.ts`, all four of its
tests. AC3 and AC4 run as this redraft on the owner's ruling ("Yes, swap it", Nov 23, 2026); the first draft is kept
by hand (`scripts/lanes-lists.mjs`).

## What fails

The first draft's `backRun` types the Send back words with `act type` while the keyboard is on the presented card, reading
its README's surface 3 ("Words are typed where the keyboard is on a presented card (its answer field)"). On an ask's page
the card's words are the box at the page's foot (#1461), and a letter typed on the card does nothing:
`tests/acceptance/1462/answers.test.ts` AC8 ("A key typed on a question card writes nothing") requires that letters typed
on the armed taste card answer nothing, send nothing and touch the box not at all. No program passes both.

Run once on the work that became `63c381b60`, before its last copy and format edits (Nov 23, 2026), each first-draft
failure is the same, the words alone; the answer goes as Send back, with its four picture entries:

```
AC3 #3234.c875f23b: … the card for ask:<ULID> ("Does the footer look right (clean)?")'s Send back must send option
  send-back with the words typed; it sent {"ask":"ask:<ULID>","option":"send-back","pictures":[{"sha256":"2ad0714e…",
  "shown":true,"scale":1,"ms":750},{"sha256":"d5a4b4fa…","shown":true,"scale":1,"ms":1700},…]}
AC4 #3234.38958545: the same (its clean run is AC3's)
AC4 #3234.38958545 wrong program: the same, for ask:<ULID> ("Does the footer look right (marks)?"), before the record is read
```

The first draft's AC3 wrong program (`refuses-send-back`) passes. On the same build this redraft passes 4 of 4, both
plants caught.

## How the redraft was made

A blind job that saw only the issue, the design, the base `f8c6cff82` and the first draft wrote it
(`4161cecd4`, cherry-picked as `a4af9907f`). It keeps the first draft's fixtures, numbers, surfaces, trace rule and
plants, and changes only how the words reach the card: ⌘N puts the keyboard in the box, as #1462 AC11 does, the words
are typed there, and Send back is pressed on the card as your hardware presses it.
