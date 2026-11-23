# Acceptance tests for #1815: ⌘F finds words on the page you're reading

Written first and blind, at base commit `a5fc47436` (main), from issue #1815 (its problem, Scope, five acceptance criteria
and Proof), the design and the base, before any implementation. The implementing agent does not edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). `TASTE.json` is the one file here
a person's call changes.

## What was read

- Issue #1815; #1462 (the action table, the menu bar, keys in a replica, reads and writes), #1498 (selection; content
  against chrome), #1808 (the lane, the title row, scrolling), #3234 and #1097 (pictures and timings) for what they ship.
- The design: the `view` row of First-party extensions that ship on by default (`node scripts/design-section.mjs --issue 1815`); Keymap, placement, window; Dogfooding; Wrong programs. `docs/canvas-primitives.md`: Selection (session state).
- At the base, for surfaces only: `crates/deep-app/src/{actions.rs,actions.json,views.rs,rows.rs,states.rs,select.rs,
  words.rs,plain.rs}`, `crates/deep-replica/src/drive/{mod,see,frames,counts,clocks,glyphs,hubcopy}.rs`,
  `crates/deep-replica/src/snapshot.rs`, `scripts/benchmark.mjs`; the suites `1461`, `1462`, `1498`, `1808`, `3234`, `1101`,
  `1097`.

## How to run

With Node 24.22 and cargo first on `PATH` (`/opt/homebrew/opt/rustup/bin`), on macOS:

```sh
npm ci --ignore-scripts && npm run build --workspaces
scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/1815 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1815/tsconfig.json
DA1815_SCREENS=<dir> ... shown        # keeps AC5's pictures, for the taste call
```

- **Builds.** One debug binary, for every file: `deep-drive` with `env-plants` and `deep-app/test-confirm`, from #1101's
  `driveBin` (in a grant of `scripts/throttle.mjs build`, kept in `$TMPDIR/da1101-bin-<uid>-<checkout>/`, reused while it is
  newer than every Rust source). With no `DEEP_HUB_PLANT` it draws as shipped (#1498's suite does the same). AC4's timed
  half builds a release replica with `frame-clocks` in a target folder of its own, only on a fit reference Mac.
- **Folders and processes.** Every HOME is a temp folder (#16's `makeHome`). No hub, no CLI and no network: the replica is
  launched on a fixture record. Only what a test started is stopped, by PID.
- **Lanes.** `lane.json` makes the folder `alone` (binary). `shown.test.ts` is run by hand (`byHand`) if the lanes should
  stay green before a taste call; the implementer makes that edit if it is wanted.
- Vitest writes `tests/acceptance/1815/node_modules/.vite/` under `--root`; delete it before committing.

## Surfaces (the implementation must provide these)

The issue names ⌘F, the field, its place and the keys, and leaves the ids open. These are the smallest that fit the
merged ones; the tests use exactly these.

1. **The field:** the one node whose `id` is `find-field` while it is open (no such node otherwise), a text input in the page's title
   row: its vertical extent meets the `page-title` node's (#1461, #1808) and it lies inside the page. Its `value` is the
   words in it. ⌘F opens it with the keyboard in it, so `act type` and `act press` with no locator reach it; ⌘A in it
   selects its words, so typed words replace them (as in the app's other inputs).
2. **The place:** a node whose `id` is `find-place` that holds the match's place as **`<n> of <m>`** in its name, its value or
   the strings drawn inside its bounds. With no match it is absent, or says anything that isn't `<n> of <m>` with m
   above 0. The issue doesn't say what it reads then, so nothing here pins it.
3. **The keys:** typed words show the first match (`1 of <m>`); Return goes to the next, ⇧Return to the one before
   (`enter`, `shift-enter`), each with its line scrolled inside the lane and the place saying it; Escape closes the field.
4. **The action:** one row of `crates/deep-app/src/actions.json` whose `key` is `cmd-f` (its name, verb and target are the
   implementer's), an item of the Edit menu under that name with that key (`menus`, #1462), which opens the field when picked
   (`act menu`, #1461).
5. **Content and chrome, as at the base.** Content is what `views.rs` draws with `content(…)` (#1498), on a session's page the lines
   `session-detail` (the newest failed run's `actual`, split on newlines, among them), each a node named by its line. The
   title and every other heading, labels, the state word and why, the return card, the list's rows and controls are chrome.
   No new kind of content is needed: a fixture's "message" is a line of a failed run.
6. **The replica and its calls, all merged:** `launch {from: "fixture", fixture, theme, frames: "dirty", read_back: "off"}`, `see` (nodes with `id`,
   `name`, `value`, `bounds`; `runs`; `address`; `log_pos`; `hub`, every call the app made of its hub), `act` press, type
   and menu, `open`, `wait_for {t}`, `menus`, `screenshot`, `close`. No new call.

## Plants

Each is selected by `DEEP_HUB_PLANT=<name>`, read through `deep_app::plain::planted` in `deep-drive`'s `env-plants` build;
everything else is as shipped.

| Plant | Criterion | The wrong program | Fails naming |
|---|---|---|---|
| `find-drawn-only` | AC1 | find searches only the content lines inside the window when its words change, not those a scroll would draw | the missed line: `reads "1 of 2", not "1 of 3": it missed "step 04003: third retry, backoff 800 ms"` |
| `find-matches-chrome` | AC2 | find counts as matches, beside the content's, the page's title and headings, the row's state word and every other label and heading the list and the page draw | the string: `find matches "<word>", which only …`, for the state word and for the title's word |
| `find-escape-rewinds` | AC3 | Escape closes the field and scrolls the page back to its top | the line: `after Escape the page lost its scroll place: "step 00203: third retry, backoff 800 ms"` |
| `find-on-ask` | AC3 | ⌘F on an ask's page, its card presented, opens the field there as on any page | the ask: `⌘F on ask/<ULID> with a card presented opens the field` |

The issue names the first two. AC3 names none; its two are the smallest programs its two sentences rule out, since "does
nothing" passes on a program with no find.

## The fixtures

`helpers.ts` `record` writes a record of the pages a test opens to a temp folder (`launch.fixture`'s form):

- **`LONG`** (AC1): a session titled `Ledger reconciliation` and its failed run (`run.finished@3`), whose `actual` is 4,100 lines,
  "backoff" in three: lines 3 and 12, on the first screen at the reference window, and line 4,003, 4,000 lines below the first
  and 97 above the last. A premise, checked: as the page opens the first two are drawn inside the lane and the third
  isn't drawn. No other text of the page, the list or the box holds the word.
- **`SHORT`** (AC2, AC3, AC5, the menu): the same on 240 lines, its third match on line 203, so a debug replica draws it in a
  twentieth of the time. `reconciliation` is in the title and in what repeats it (the row, the status line, the return card),
  never in a content line; the row's state word is read from the row's word slot (`queued` at the base) and must be in no
  content line either, in any case.
- **`BIG`** (AC4): 10,000 lines, a single `Q` in the line before the last, and no other q in any case.
- **The asking session** (docs): one open choice ask, `ask/01KB1815AK0000000000000001`.

The fixtures' words are typed in the case they are written in; nothing pins a case rule.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`.

| Criterion | ID | Test | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#1815.346b32b0` | `find.test.ts`: the page as it opens, ⌘F, "backoff" reads `1 of 3` with its line in the lane; Return `2 of 3`; Return `3 of 3`, line 4,003 inside the lane; ⇧Return `2 of 3`; the field in the title row; no call of the hub, the record where it was, the same address. A second test, the Scope's: ⌘F is one action of the table, in the Edit menu with its key, and picking it opens the field | the base (no field; no action on cmd-f); `find-drawn-only`, naming the missed line |
| AC2 | `#1815.d7e06bb8` | `find.test.ts`: in the field that reads `1 of 3` for "backoff", the row's state word and the title's word are no match | the base (no field); `find-matches-chrome`, naming each string |
| AC3 | `#1815.fb03fd00` | `find.test.ts`: from the third match, Escape: no field, the same address, the line where it was; then the ask's page with its card armed: ⌘F opens nothing, changes no node, bound, drawn string or focus, sends no write and leaves the record | the base (no field); `find-escape-rewinds`; `find-on-ask` |
| AC4 | `#1815.e2a26281` | `budget.test.ts`: on any machine the 10,000-line page's one match shows, `1 of 1`, its line in the lane; on a fit reference Mac its time is judged against 100 ms | the base (no field); elsewhere the timing is INCONCLUSIVE, never PASS |
| AC5 | `#1815.0afba244` | `shown.test.ts`: one picture a theme, light and dark, each once the field, `3 of 3` and its line inside the lane are on the window's tree, then `TASTE.json`: INCONCLUSIVE until a recorded call on exactly these files | the base (no field); a picture is never judged here |

## Readings, where the issue leaves a choice (a redraft may revisit them)

1. **"The fixture session's three matches walked on the real app"** (Proof) is read as the app's own views, text input and
   key path, drawn headless by the replica (design: Replica), as #3234's and #1101's pictures and journeys are; AC5's "from
   the real app" likewise. No real-window walk is here: it would need Accessibility and an unlocked screen and see nothing
   the replica doesn't.
2. **"Its line inside the lane"** is the line's drawn bounds (the uncut string, else its node) inside the `lane` node's
   bounds under the title row and inside the window.
3. **"The page keeps its scroll place"**: the third match's line is still inside the lane and stands where it did within 2
   device px, from the window's top, or from the title row's foot where closing the field changes the row's height.
4. **"Writes nothing and moves nothing"**: the window on the ask's page is compared with itself 500 ms before and after
   ⌘F, every node (role, id, name, value, bounds), drawn string, the keyboard's place and the address; the same comparison
   with no key between must be equal first, else BLOCKED. A write is any hub call but #1462's reads; the record's position
   is `log_pos`.
5. **"Sends nothing"** (Scope): from the page as it opens to ⇧Return the app makes no call of its hub at all. (At the base an open
   session page makes none.)
6. **AC4's time** runs from sending one key to the drawn window that shows its match in the lane. The wall time holds the
   replica's own reading of the window, so it can only be too long and is what passes; the main thread's CPU over those
   frames can only be too short and is what fails; between them is INCONCLUSIVE (`budget.test.ts`).
7. **The mark** is a picture's matter (AC5): #1498 shipped its selection as an outline, and no criterion names its pixels.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: ⌘F on a page that is neither a session's nor an ask's, or with the
field already open; what the field holds when it opens again; whether Return after the last match wraps; matches that
span lines, two in one line, or in case or accents other than the fixture's; a session's Changes and messages the base
doesn't draw; the field under 848 wide.

## Files

- `helpers.ts`: IDs, plants, the fixture record; the replica, find's keys and place, the readers of the window.
- `find.test.ts` (AC1, AC2, AC3), `budget.test.ts` (AC4), `shown.test.ts` (AC5).
- `TASTE.json`, `lane.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
