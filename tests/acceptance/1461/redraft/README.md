# #1461, blind redraft: AC7, AC10, AC18, AC19, AC25 and AC27

A fresh run of the blind acceptance-test job for #1461 under the Dogfooding rule (docs/technical-design.md, Dogfooding;
AGENTS.md, Proof), for six criteria, each with its named wrong program. It saw the issue, the design and the base, and
the earlier blind suite's `README.md` and `helpers.ts` (commit 866a8b29) for its surfaces only. It never saw an
implementation of #1461, a diff, a dispute or the earlier suite's tests for these criteria. The implementing agent does
not edit these files.

The criteria, verbatim:

- **AC7** `#1461.a07a4336`: A replacement view that passes `needs-you@1` still fills the list's first section, and a
  planted one that hides the oldest ask fails, naming the ask
- **AC10** `#1461.52fe1d2f`: Every list row is 32 tall with its slots at the stated places, read from the snapshot. A
  planted 24 row fails, naming it
- **AC18** `#1461.c16105e5`: With the pointer resting on the third session row, a new ask arrives and shifts that row. A
  press 100 ms later opens nothing. A planted list that opens the row that slid under the pointer fails, naming both rows
- **AC19** `#1461.d5aa2f05`: On #328's fixture with a folded, a later and a held ask, each row's value and state word name
  its state. A planted row that differs from an open ask only by ink fails, naming the row
- **AC25** `#1461.97cc6522`: A press 400 ms after a row moved opens the row now under the pointer. A planted list that
  drops every press fails
- **AC27** `#1461.a024b727`: Two asks of different kinds differ in their rows' state words. A planted list that draws both
  alike fails, naming the pair

## What was read

- Issue #1461 (body and comments): Scope's row and list numbers, "When rows move, one rule", "An ask row says which kind
  of waiting it is", the ask row's kind word, the `sidebar` decision.
- `docs/technical-design.md`: Keymap, placement, window (One list and one page, Address); Needs-you view; Replica; States
  people see; Dogfooding.
- At the base: `crates/deep-replica/src/{lib,kit,shell,snapshot}.rs` and `drive/{mod,frames,locate,glyphs}.rs` (launch
  options, `act`, `feed`, `wait_for`, `see`'s `runs`, `views` and text nodes, the hit test, what a script view leaves in
  a snapshot); `crates/deep-app/src/{views,events,record}.rs` (how the base draws ask rows; folded, later and held);
  `packages/asks/src/index.ts` (what each kind needs to be raised: an authority ask its plan and a deny option, a default
  that names an option; fold, Later and hold); `packages/hub/src/{rows,status}.ts` (row ids, order, when a session reads
  needs you or quiet); `docs/spikes/338/` (#328's fixture and how it is made); `tests/acceptance/26/helpers.ts` (`seed`,
  `askData`), `tests/acceptance/1459/{helpers.ts,kit.test.ts,fixtures/views}`, `tests/acceptance/1463/helpers.ts`;
  `scripts/proof-change.mjs` (criterion IDs, checked against the issue's text).
- `../README.md` and `../helpers.ts` from 866a8b29, for the surfaces reused below.

## How to run

These files import `../helpers.ts` and read `../README.md`'s pins, so they run beside the suite at 866a8b29. With Node 24
first on `PATH`, cargo 1.99.1 on `PATH` (`$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`), on macOS:

```sh
npm ci --ignore-scripts && npm run build --workspaces
caffeinate -di npx vitest run --root tests/acceptance/1461/redraft --no-file-parallelism --testTimeout=1800000
node node_modules/typescript/bin/tsc -p tests/acceptance/1461/redraft/tsconfig.json
```

`../helpers.ts` builds `deep-drive` plain and with `env-plants` (`DEEP_HUB_PLANT` selects a plant) and copies each out of
the target folder; #1459's helpers build `deep-replica` for `--view-kit`. Homes are temp folders; only processes the
tests started are stopped, by PID. Vitest writes `node_modules/.vite/` under the root; delete it before committing.

## Surfaces reused (`../README.md`, Pinned)

- Pinned 1: the list `id: "list"`; headings `heading:needs-you` (first) and `heading:<project>`; rows `ask:<ULID>`,
  `session:<id>`, `quiet:<project>`; each row's slots `<row>:mark`, `<row>:title`, `<row>:word`, `<row>:time` with their
  own bounds; a folded, later or held row's value and state-word slot.
- Pinned 3: `launch.replaces: "needs-you"` with `panel`, the view replacing Needs you drawn as the list's first section.
- Pinned 4: `act {"kind": "click", "point": [x, y]}`, a press where the pointer is, in device pixels.
- Pinned 8: the plants `row-24`, `wait-by-ink`, `ask-words-alike`, `press-through-move`, `list-drops-presses`.
- Merged: `deep-drive`'s `launch` (`from`, `size`), `see` (`snapshot` with `runs`, `rows`, `address`), `act hover`,
  `feed`, `wait_for`; `deep-replica --view-kit needs-you@1` and #1459's views; `makeWorld`, `feedAsk`, `replicaOf`.

## Criterion to tests

| Criterion | ID | Test | Wrong program it fails on |
|---|---|---|---|
| AC10 | `#1461.52fe1d2f` | `rows.test.ts`: over a hub-built record (an approval and a choice open, sessions working, finished and flagged in three projects), every list row is 32 tall; its mark slot 16 wide and 16 from the list's left edge; its title 8 after the mark slot; then its state word, then its time, at least 32 wide, ending 16 from the list's right edge; every slot inside the row's height | `row-24`: a failure `row <id> is 24 tall, not 32` for a row in the list |
| AC19 | `#1461.d5aa2f05` | `rows.test.ts`: on #328's fixture (`launch.from: "fixture"`, 1512 × 1600 so Needs you's 40 rows fit), the five folded rows, the Later one and the held one each say so in their value and state word, and no open ask's row says folded, later or held | `wait-by-ink`: a failure naming a waiting row drawn with an open ask's value and word |
| AC27 | `#1461.a024b727` | `rows.test.ts`: on AC10's record, the push approval's and the choice's state-word slots draw different words | `ask-words-alike`: the one failure, both rows named |
| AC18 | `#1461.c16105e5` | `moves.test.ts`: one project of six sessions, one already asking; the pointer rests on the third session row (`act hover`), a new ask on the asking session arrives (`feedAsk`), the row moves and a row lies under the pointer (both asserted, read from the snapshot); 100 ms later a press at the point; half a second on, the page's address is unchanged | `press-through-move`: the one failure, naming the row the pointer rested on and the row that slid under it |
| AC25 | `#1461.97cc6522` | `moves.test.ts`: the same journey, the press 400 ms after the move opens the address of the row now under the pointer | `list-drops-presses`: the page unchanged |
| AC7 | `#1461.a07a4336` | `tree.test.ts`: #1459's `needs-you-by-id` passes `needs-you@1`; installed with `replaces: "needs-you"` over a record with three open asks, the strings drawn in the list's width between `heading:needs-you` (the list's first heading) and the next heading hold the view's own heading and every open ask's question, oldest first | #1459's `hides-oldest`: `needs-you@1` fails naming #328's fixture's oldest open ask, and the window's one failure names the record's oldest ask |

## Readings a later redraft may revisit

1. **Where a row's slots sit (AC10).** "The list inset is 8 and the row inset 8, so titles sit 16 from the edge. The mark
   slot is 16 with 8 after it" is read as the row's content starting 16 from the list's edge: the mark slot at 16, the
   title at 40. Places are measured from the list node's edges, not the row node's, so a row node that spans the list
   with its background inset passes as one inset by 8 does. The right side mirrors the left: the time ends 16 from the
   list's right edge. Tolerance is one point. The row's horizontal extent, the gap between rows and headings' 32 with 8
   above aren't checked: the criterion names the row's height and its slots.
2. **A slot's word (AC19, AC27)** is the strings drawn with their centre inside the slot's bounds, else its accessible
   name. A value is the row node's `value`, as text.
3. **#328's fixture's Later (AC19).** The fixture's one `ask.later` is written by `app`. At d51be2c3 the record the window
   draws reads any writer's Later; main since 9b953244 ("Only the core's Later hides an ask, as in the core",
   `crates/deep-app/src/record.rs`) reads only the core's, which is how the asks core writes it. This draft counts only
   the core's, so on main the fixture holds no Later the window can draw and AC19's plain test fails its fixture check
   (`[5, 0, 1]`), saying so, until `docs/spikes/338/make-fixture.mjs` writes its Later as the core. The held ask is the
   replica's `HELD` (`crates/deep-replica/src/lib.rs`), since the record has no event for a hold; folded asks are a
   session's open asks past its fifth. The words matched are `fold`/`folded`, `later` and `held`, any case.
4. **AC18 and AC25's world** has one project, so the session rows sit under one heading whatever order projects take,
   and the new ask goes to the session already asking, so no session changes state. The test still reads which row the
   pointer is over after the shift, and fails naming what it found if that is a heading, nothing or the same row, or if
   the row didn't move. "Opens nothing" is the page's address unchanged half a second after the press, so a press held
   back and delivered after the 300 ms also fails. A row's address is the hub row's `address`.
5. **AC7 reads the replacement by its drawn strings.** A script view's elements aren't observed elements, so the
   replica's snapshot holds no node or id of theirs (`crates/deep-replica/src/shell.rs`, `rows_of`; `drive/glyphs.rs`):
   only every string the frame drew. The first section is the list's width between Needs you's heading and the next
   heading. The view's heading, "Asks for you", says the strings are the view's, and the planted view's run shows the
   questions come from the view, not from shipped rows drawn alongside. Questions are short, so none wraps or is cut.
   "Fails, naming the ask" is read two ways, both checked: the kit's verdict names the oldest ask of its own record, and
   the window's first section leaves the world's oldest ask out.
6. **AC27's two kinds** are the two the issue names as words, an approval (a push, with its plan) and a choice. Words
   are compared without case.
