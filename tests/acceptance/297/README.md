# Acceptance tests for #297: typed names on screen: a text shows each player's latest entry to a text control, fit-checked, with the string never passing through logic

Written first, blind, from issue #297 (live: its Scope, its Fields, its eleven acceptance criteria, its Proof line and its
Oracle line), the design sections it links and those they lean on, and the base commit, by a job that never saw an
implementation; none existed, and no other worktree, branch, pull request or stash was read. The base is `4bf2fc7ad`
("Merge pull request #2899"), one merge past `531da1ef0` ("Merge pull request #2910"), the commit this job was asked to
start from; #2899 (moved kinds, #1962) touches none of the surfaces below. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Lean: one file per criterion, one test per part of a criterion and one per planted twin it names, each test's name
carrying its criterion's ID. The Oracle line's lane is `tests/acceptance/297-oracle/` (its own README).

## What was read

- The issue (`gh issue view 297`); its dependencies #535, #542 and #549 (merged at the base); #550 for what is the net
  module's (peers' entries checked in general: not built, and not this issue's but for the one refusal criteria 4 and 8
  name); the Oracle page `doneright/oracles/issues/297.md` on branch `doneright` of `DeepBuildAI/deepbuild`, and the two
  files it pins (fetched with `gh api` for the Oracle lane).
- `docs/canvas-primitives.md`: Text `text@1` (its fields, `widest`, `fallback`, `text.glyph_missing`, the ellipsis),
  Text `text@1`: keyed copy, Text `text@1`: entries, Control, Control: text, Mark set and columns `marks@1`, Mark set:
  logic columns, Array and table: column view, Net `net@1`, Net: lockstep, Check input: net kinds.
  `docs/technical-design.md`: Control and input track; Dogfooding; Tests written first. AGENTS.md.
- At the base, only for surfaces and conventions: `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`;
  `crates/deep-show` (`main.rs`'s calls, `frames.rs`'s `eval` and its `texts`, `fields.rs`'s text control and its
  notices, `net.rs`'s `match` and `render_back`, `track_call.rs`'s `load`, `hub.rs`'s look by asset);
  `crates/deep-canvas-input/src/text.rs`; `crates/deep-canvas-marks` (`check.rs`'s `text.glyph_missing`, `copy.rs`'s
  keyed copy, fit check and `copy.missing`, `scene.rs`'s text spec, `looks/clean.json`); `crates/deep-text/src/shape.rs`
  (the ellipsis); `crates/deep-net` (`play.rs`, `copy.rs`, `kind.rs`); `crates/deep-logic/src/piece.rs` (a text
  control's slot); the bundled faces' character maps and advances (`crates/deep-text/fonts`, read by a scratch script);
  the suites `549/` (the `match` call, `render_back`, programs as bytes), `542/` (typing, commits, notices, the read
  region), `538/` and `538-oracle/` (keyed copy, the fit check, the taste call, an Oracle lane), `535/`, `540/`,
  `417/` and `1965-oracle/` (fallback, `text.glyph_missing`, the two Unicode files).

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and `fixtures.ts`.

## What the base already does, and these tests don't credit

`deep-show run` presents the fixtures' documents as they are once each entry form is written as a literal string (probed
before the run, not committed): the two-seat net item, the `seats` logic item, the text control `name` with its
`default`, the look by asset, a mark set whose `seat` column reads `seats.spot` as f64, a text control with `max_bytes`
64. Tab focuses `name`; typing and Enter commit one entry; `track` gives the track and its hash; `eval` gives a snapshot;
`match` takes string values in `plays`, and its `render_back` rows are PNGs in the evidence store; `logic` gives each
step's arrays. None of the issue's behaviour exists: a text's `text: {entry, …}` and a text column's `{entry, …}` are
refused at check; there is no `shown`, no `entry.missing`, no skeleton numbering, no refusal of a hidden character, a
blank entry or a mark stack, no copy's `refused`; `track`'s `load` refuses an entry whose `writer` is `peer`; a
`render_back` row draws the document's revision, not the copy's own track; the ellipsis cuts by character; none of the
nine planted names. Every test fails at the base; `BASE-FAILURE.txt` is the run.

## Run them

```sh
npm ci                                   # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/297 --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/297          # type check (exits 0)
rm -rf tests/acceptance/297/node_modules           # vitest's cache after a --root run
```

Each file builds `deep-show` once, in `beforeAll` (`cargo build --locked --bin deep-show`, the default `full` set),
honoring `CARGO_TARGET_DIR`, with the pinned toolchain's folder first on PATH when it is there, and copies it to a
temporary folder. Every test passes its own timeout of an hour, the build two. Evidence stores are temporary and deleted;
only `ac11-taste.test.ts` writes outside them, its pictures to `docs/evidence/297/`. Imports: Node built-ins, vitest and
`../467/helpers.ts`'s PNG reader and writer (read only). No process is started but `cargo` and `deep-show run`, each
waited for; none is stopped by name or port. No test reads a time or the machine's load.

**The lanes line.** The suite builds a cargo binary, so the implementer adds this to `scripts/lanes.mjs`, beside #542's
and #549's (this README is the instruction):

```js
// #297's files each build deep-show and run its scenarios; the Oracle lane runs thousands of frames through it.
alone.push('tests/acceptance/297/', 'tests/acceptance/297-oracle/');
```

**Gates.** No cargo is `BLOCKED:`. Criterion 11 is `INCONCLUSIVE:` until its taste call is recorded. Neither is a pass.

## The surface under test

The issue names entries, entry texts, a fit check, notices, refusals, `entry.missing`, a track's hash, a two-copy match,
pixels and planted programs, but no call. As #542's and #549's suites do, everything goes through `deep-show run` (#393:
one JSON scenario on stdin, one answer line `{"ok": true, "replies": [...]}`, one reply per call), the binary that holds
the text control, the text module, the logic module, the column view and the net module's `match`. The scenario is
#542's: the agent's session, a process table, one 480 × 240 px panel a document (`p1`, `p2`, …), the scope's virtual
clock (`{refresh_hz: 120, lead: 2 ms, check: 0.5 ms}`, each call at its `at`), a display, and `planted` where a test plants
a twin. Times in calls are flicks (705,600,000 a second); every fixture steps at 60 Hz, its logic and its match alike, so
step k is at k × 11,760,000 flicks.

### Calls

| Call | What the tests send | What they read | Whose |
|---|---|---|---|
| `deep_show` | `{session, doc, document, include: ["issues"]}` | `outcome` (`presented`), `issues` (`severity`, `code`, `path`, `ids`, `actual`) | #393's |
| `input` | `{panel, event}`: `{type: "key", key: "Tab" \| "Enter"}`, `{type: "text", text}` | `state.focus`; `appended`, the entries the input wrote | #383's, #504's, #542's |
| `see` | `{panel}` | `announcements` `{t, id, text, …}`: the control's notices | #376's, #542's |
| `track` | `{doc, load?}` | `track` (the entries), `hash` | #1164's |
| `eval` | `{doc, t, shown: true, pixels?, track?}` | `outcome`, **`shown`**, `issues`, `snapshots[0].sha256` | #387's; `shown` this job's |
| `logic` | `{doc, steps}` | `steps[].arrays["echo.head"]` | #539's |
| `match` | `{doc, steps, plays, render_back?}` | `copies[]` (`player`, `record.track`, **`refused`**), `renders[]` (`player`, `t`, `step`, `sha256`, **`shown`**) | #549's; the bold fields this job's |

## Choices

Every name below that the issue or the design doesn't give is this job's choice, the smallest the criteria need; the
implementer builds exactly these, or a dispute goes to a blind redraft.

- **`eval`'s `shown`.** With `shown: true` the reply carries `shown: {<id>: string}`: for every entry text the frame
  draws, the string it shows at t, keyed by the item's ID, and for every row of a mark set's entry text column by
  `<set>#<key>` (`plates#0`, `plates#1`: a set with no `key` keys its rows by index). The string is what is drawn: the
  entry's NFC form, with ` (n)` when numbered, cut with `…` (U+2026) when it overflows; the control's default before
  the player's first entry; `""` for an entry text that shows nothing. Every other reply field is as at the base.
- **`match`'s `render_back` rows**, the issue's "frames" of each copy: `sha256` is that copy's own frame at `t`, drawn
  from that copy's own track (the base draws the document's revision for every copy), its PNG in the evidence store, as
  at the base; each row gains `shown`, as `eval`'s, for that copy at `t`.
- **A copy's `refused`**, always an array on each of `match`'s `copies`: one row for each entry that copy refused,
  `{step, player, control, reason, grapheme}`. `step` is the match step the entry was stamped at, `player` the player who
  made it, `reason` one of `glyph_missing` (a grapheme the entry texts' fonts can't draw), `hidden_character`, `blank`,
  `mark_stack`, and `grapheme` the first grapheme that broke the rule (null for `blank`). The tests read `player`,
  `control` and, in criterion 8, `reason`, and compare the copies' rows whole. A refused entry changes nothing a copy
  shows.
- **A modified copy's commit** is a script entry of `match` (#549's `plays: {"<player>": [{step, control, value}]}`):
  what that player's copy commits, with no typing in it, so a value the control would refuse as typed reaches the match.
  The honest players' commits in criteria 2 and 10 are script entries too.
- **A refused grapheme's notice** is an announcement of the control in `see` (as #542's refused paste is), `{t, id:
  "name", text, reason, grapheme}`: `reason` as above, `grapheme` the grapheme refused. A test takes a notice as naming
  a grapheme when its `grapheme` is that grapheme, or its `text` holds it or its code points written `U+XXXX`.
- **Typing**: Tab focuses `name`; each `text` event is typed text; Enter commits. Where a test types one string that
  breaks a rule as one event (criterion 9's three U+200B and its 5-mark stack), the control refuses it whole, with the
  rule's reason; where the string is three events (criterion 8), the event holding U+202E is the one refused.
- **`entry.missing`** is raised in `eval`'s `issues`, as #538's `copy.missing` is: `{code: "entry.missing", control,
  player, step}`, its fields at the issue's top level or under `actual`, raised by the frame of the step the player
  number begins to have no seat; with `player: 5` written, step 0.
- **Seats and players.** A piece's seats are its net item's `players` (`players: 2`: seats 1 and 2). An entry with no
  `player`, which is what typing writes outside a match, is player 1's.
- **A recorded track.** `track`'s `load` and `eval`'s own `track` take the entries a match's record gives (#549):
  `{t, seq, control, value, writer: "you" | "peer", player}`. The tests write player 1's as `you` and player 2's as
  `peer`, as copy 1's record does.
- **Refused at check, naming it**: `deep_show` answers other than `presented`, with an error that names the item (in
  its `ids`, its `item`, `set` or `reader`, or its path's item segment) and the field: `widest` (a path segment, the
  issue's `field`, or the issue's own fields holding the word) for criterion 3; `player`, or for the mark set its
  column `seat` (a path segment, `field` or `column`), for criterion 7. Criterion 10's fit failure is an error naming
  the item; its code is the implementer's.
- **Planted twins** (below): nine values of the scenario's `planted`.

### Planted twins

Each is one criterion's wrong program, reachable only through the scenario's `planted`, and changes nothing else; any
other value stays `bad_input`. `twins.json` maps each criterion's ID to its twin. Criterion 7 names no planted program;
its wrong program is the merge base. Criterion 11 judges no program.

| Name | Criterion | The wrong program | The test fails it, naming |
|---|---|---|---|
| `entry_any_player` | 1 | an entry text shows the control's latest entry by any player | item `plate1` showing "Ana" at step 95 |
| `entry_own_viewer_only` | 2 | each copy shows only its own viewer's entries; another player's rows show what they show before that player's first entry | the row (`plates#0` or `plates#1`) whose string differs between the copies whose pixels differ |
| `fit_skips_entries` | 3 | the fit check skips entry texts, so an entry text needs no `widest` and is never fitted | item `long`, presented with no `widest` |
| `entry_takes_missing_glyph` | 4 | the range a text control takes, as typed and on every copy, admits a grapheme the entry texts' fonts can't draw | the grapheme 字 (U+5B57) that a copy draws |
| `entry_falls_back_to_player_1` | 5 | an entry text bound to a player with no seat shows player 1's entry | item `ghost` showing "Kai" |
| `entry_normalizes_track` | 6 | an entry text normalizes the entry it shows to NFC on the input track | the entry `{control: name, t}`, by the track's hash or its bytes |
| `control_takes_hidden` | 8 | the control, as typed and on every copy, takes a hidden character | the commit, and `plate1` showing it |
| `control_no_mark_limit` | 9 | the control, as typed and on every copy, takes any number of combining marks on a base | the grapheme 'a' + 5 × U+0301 |
| `entry_compare_code_points` | 10 | two seats' entries are compared by code points, not by their UTS #39 skeletons | both seats' plates, unnumbered |

## Programs

WebAssembly written as bytes (`helpers.ts`'s `logicModule`, in #549's form: one page of memory, `reads_at`,
`writes_at`, `init`, `step`, no imports). Arrays are laid out in declaration order on 8-byte boundaries from 4096,
declared in alphabetical order too.

- `seats` (`seatsProgram`): `spot` f64 × 2 = [1, 2], then `who` i32 × 2 = [1, 2], written every step: each seat's number
  as a float and as an integer. It reads nothing.
- `echo` (`echoProgram`): declares `name` as a read (`reads_at` 0) and writes `head` i32 × 6, the read region's first 24
  bytes (`name`'s whole slot: 4 + 16, rounded up to 8) as six u32 words, every step.

## Fixtures

`fixtures.ts`. Every piece is a figure with a transport (#542's form): 480 × 240 u in a 480 × 240 px panel, a 2D
orthographic camera, 10 s at 60 fps, `requires: {modules: {input, logic, net}}`; `seats`; the net item `match`
(`relay: "https://relay.test/297"`, which nothing joins, `players: 2`, `step_rate: 60`, `delay: 2`, `window: 0`); and
the text control `name` (`{kind: "text", class: "document", label: "Name", role: "textbox", default: "Player", text:
{max_bytes: 16, lines: "one"}}`, the `max_bytes` criterion 1's). Each program is in the evidence store and in `assets`.

| Item | As written | Criteria |
|---|---|---|
| An entry text | `text@1`: `text: {entry: "name", player, widest: "WWWWWW"}`, `size: 16`, `box: {w: 158, h: 24}`, `max_lines: 1`, `overflow: "ellipsis"` | all |
| `plate1`, `plate2` | entry texts bound to players 1 and 2, at (16, 40) and (16, 120) | 1, 4 to 11 |
| `plates` | `marks@1`, `mark: "text"`, two rows at (16, 60) and (16, 150) (`x`, `y` f32 data columns), `seat: {array: "seats.who", as: "u8"}`, `text: {entry: "name", player: "seat", widest: "WWWWWW"}` | 2, 11 |
| `long` | an entry text for player 1 at (16, 80), with `widest` or without it | 3, 11 |
| `ghost` | an entry text bound to player 5, at (240, 80) | 5 |
| `bound` | an entry text whose `player` is `seats.spot[0]` (f64) or `seats.who[0]` (i32) | 7 |
| `plates`, read as f64 | the mark set with `seat: {array: "seats.spot", as: "f64"}` | 7 |
| the look `latin-297` | `crates/deep-canvas-marks/looks/clean.json` as it stands, with `id: "latin-297"` and `fallback: []`, put in the evidence store and named by the document's `look: {asset: "latin-297@1"}` | 4 |

The numbers: **158 u** is "a box sized for 10 of the widest glyph": W is the body face's widest Latin letter, 2018 of
2048 units an em in Inter (its `hmtx`), so 10 W at 16 u are 157.66 u. **`widest` "WWWWWW"** is 94.6 u, and 120.5 u
with " (2)" (space 576, parentheses 747 each, 2 1249 units), so it fits every 158 u box with any seat's number.
**105 u** (criterion 10) fits it alone and not with " (2)". The names: criterion 1's, 2's and 10's as the issue gives
them or plain names; criterion 3's 16-letter name is sixteen W; criterion 9's family emoji is U+1F468 U+200D U+1F466
(family: man, boy; 11 bytes, inside `max_bytes` 16), which the shipped look's emoji face (Noto Emoji) draws as one
ligature glyph (its GSUB, read by a scratch script). Inter draws Latin and Cyrillic (U+0421, U+043E, U+0441 among its
glyphs) and no Han (U+5B57 maps to no glyph).

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s `criterionId`: `#297.` and the first 8 hex digits of the SHA-256 of each
criterion's text, trimmed, white space collapsed, from the live issue. Each test's name starts `AC<n> #297.<id>`; each
file quotes its criterion in full. Test count: 2 + 2 + 3 + 3 + 2 + 2 + 2 + 3 + 4 + 4 + 1 = 28 (and 2 in the Oracle
lane).

| AC | ID | File (tests) | What it asserts |
|---|---|---|---|
| 1 | `#297.688a1e6a` | `ac01-latest-entry.test.ts` (2) | On the recorded track (seat 1 "Kai" at step 30 and "Kai Ng" at 90, seat 2 "Ana" at 95): `plate1` shows "Player" (the default) at steps 10 and 29, "Kai" at 30 and 89, "Kai Ng" at 90 and 95, and after the seek to step 100 "Kai Ng" there and the same strings back at 10, 30, 90 and 95; `plate2` shows "Player" before step 95 and "Ana" from it. `entry_any_player`: `plate1` shows "Ana" at step 95, and the failure names the item |
| 2 | `#297.3618602e` | `ac02-two-copies.test.ts` (2) | `match` of 300 steps, seat 1 "Kai" (lands at step 33) and "Kai Ng" (145), seat 2 "Ana" (75) and "Ana Lee" (215): at 20 sampled times (steps 12 to 278, 14 apart, each half a step past) both copies' frames have one `sha256`; each row shows its seat's latest name by the render's own `step`; two samples with the same names have the same pixels and other names other pixels. `entry_own_viewer_only`: the copies' pixels differ, and the failure names the row whose string differs |
| 3 | `#297.d2e288d8` | `ac03-fit.test.ts` (3) | `long` in its 158 u box shows the 16 W cut with U+2026: before it, the first 1 to 15 graphemes of the name (the platform's own segmenter). The piece whose `long` has no `widest` is refused, with an error naming `long` and `widest`. `fit_skips_entries`: that piece is presented, and the failure names item `long` |
| 4 | `#297.ee30ab4e` | `ac04-missing-glyph.test.ts` (3) | In the look `latin-297`: Tab focuses `name`; 字 typed gives a notice of `name` naming 字; nothing committed holds it; `plate1` shows "Player". In `match`, player 2's script commits "Ana" (step 30) and 字 (step 60): each copy's `refused` holds a row of `name` naming player 2, the copies' rows equal; at step 90 both copies' `plate2` show "Ana", no shown string holds 字, one `sha256`. `entry_takes_missing_glyph`: a copy draws 字, and the failure names the grapheme |
| 5 | `#297.50f2c738` | `ac05-no-seat.test.ts` (2) | On the recorded track (seat 1 "Kai" at 10, seat 2 "Ana" at 20): `ghost` (player 5) shows `""` at steps 0 and 40, and a frame raises `entry.missing {control: "name", player: 5, step}` naming its own step. `entry_falls_back_to_player_1`: `ghost` shows "Kai" at step 40, and the failure names the item |
| 6 | `#297.cd44d20a` | `ac06-nfc-shown.test.ts` (2) | "e" and U+0301 typed, Enter: one entry holding 65 cc 81; `plate1` shows U+00E9; the track's hash after the frame equals its hash before it, and the track still holds 65 cc 81. `entry_normalizes_track`: the hash or the bytes change, and the failure names the entry `{control: name, t}` |
| 7 | `#297.855382ad` | `ac07-binding.test.ts` (2) | `bound` reading `seats.who[0]` and the mark set reading `seats.who` as u8 are presented; `bound` reading `seats.spot[0]` is refused with an error naming `bound` and `player`, the mark set reading `seats.spot` as f64 with one naming `plates` and `player` or `seat`. "Zoe" and U+0308 typed, Enter: one entry holding 5a 6f 65 cc 88; one step of `logic` reads a commit, its region's first 16 bytes 05 00 00 00, the five bytes, 7 zero bytes |
| 8 | `#297.8d736efc` | `ac08-hidden-character.test.ts` (3) | 'Ana', U+202E, 'xyz' typed as three events, Enter: a notice of `name` from U+202E on, reason `hidden_character`, naming U+202E; nothing committed holds U+202E; `plate1` shows the NFC form of the seat's last committed name on the track (or the default) and no U+202E. In `match`, player 2's script commits "Ana" (step 30) and 'Ana' U+202E 'xyz' (step 60): each copy refuses a `name` entry naming player 2 with reason `hidden_character`, the rows equal; both copies' `plate2` show "Ana" at step 90, one `sha256`. `control_takes_hidden`: the commit holds U+202E and `plate1` shows it |
| 9 | `#297.a18ed59e` | `ac09-blank-marks-joins.test.ts` (4) | Each typed as one event, then Enter, in a run of its own: three U+200B give a notice with reason `blank`, commit nothing holding them, and leave "Player"; 'a' + 5 × U+0301 gives a notice with reason `mark_stack` naming the grapheme, commits nothing holding it, leaves "Player"; 'a' + 4 × U+0301 commits exactly that, gives no notice, and `plate1` shows its NFC form; the family emoji commits exactly its 11 bytes, gives no notice, and `plate1` shows it, one grapheme. `control_no_mark_limit`: the 5-mark stack is committed, and the failure names the grapheme |
| 10 | `#297.597888a6` | `ac10-look-alike.test.ts` (4) | In `match`, seat 1's script commits 'Coco' (step 20), seat 2's U+0421 U+043E U+0441 U+043E (step 40): at step 60 both copies show 'Coco (1)' and the Cyrillic string with ' (2)', one `sha256`; each copy's recorded track, in a second run, shows the same at step 100 and after the seek back to step 50. 'Coco' (seat 1) beside 'Cocoa' (seat 2) shows both unnumbered. `entry_compare_code_points`: the pair is unnumbered, and the failure names both seats. The piece with `plate1`'s box at 105 u is refused with an error naming `plate1` and none naming `plate2`, while the same piece at 158 u is presented |
| 11 | `#297.5d8a3e72` | `ac11-taste.test.ts` (1) | The check run (below) writes the five pictures and prints their SHA-256s, then reads `TASTE.json`: none, or a call on other pictures, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture |

## The taste call

`ac11-taste.test.ts` is the check run. It draws the criteria's own fixtures through `deep-show run` and takes each picture
from the canvas's own canonical render (`eval`'s snapshot; each copy's frame `match`'s `render_back` draws), PNGs the
canvas stored in the evidence store, re-encoded so the same pixels always give the same bytes, into `docs/evidence/297/`:

- `names.png`: the nameplates at step 100, seat 1 "Kai Ng" and seat 2 "Ana" (criterion 1's track);
- `look-alike.png`: 'Coco (1)' and the Cyrillic look-alike with ' (2)' at step 60 (criterion 10);
- `marks.png`: seat 1's "e" + U+0301 shown as é and seat 2's family emoji at step 30 (criteria 6 and 9);
- `ellipsis.png`: the 16-letter name cut in its box at step 20 (criterion 3);
- `copies.png`: criterion 2's two copies' frames at step 236 ("Kai Ng" and "Ana Lee"), side by side on a grey strip,
  nothing drawn over either.

Each SHA-256 is printed. `tests/acceptance/297/TASTE.json`, written by whoever records the call after the pictures are
attached to the PR and shown in the session: `{"issue": 297, "criterion": "#297.5d8a3e72", "verdict": "looks_right" |
"looks_wrong", "who", "when": ISO 8601, "screenshots": {<each of the five names>: sha256}, "note"?}`. A call stands
while this run's five hashes equal the ones it names. No agent records a call it wasn't given; this job wrote none.

## Readings where the issue leaves a choice

- **"Shows"** is read from `shown`, the string the frame draws, never from a picture (criterion 11 aside); criterion 2's
  "same pixels" is the frames' `sha256`, and its pixels are also held to follow the names, so two copies that draw
  nothing can't pass.
- **"Commits … at step k"** (criteria 1, 5, 10's 'Cocoa'): the match's recorded track, loaded (`track`'s `load`), each
  entry at k × 11,760,000 flicks; the frame at step k shows it. **"In a two-seat match"** (criterion 5): the piece whose
  net item seats 2, its recorded track played. In criteria 2, 4, 8 and 10 the match is played (`match`), each commit a
  script entry made `delay` (2) steps before the step it lands at.
- **"Also after a seek to step 100"**: the frames at steps 10 to 95 in order, then step 100, then back to 10, 30, 90
  and 95 on the same session. **"Before and after a seek"** (criterion 10): the copies' frames during the match, and each
  copy's recorded track at step 100 and then back at step 50.
- **"The default"**: the control's `default`, "Player". **"Shows nothing"** (criterion 5): `""`.
- **"20 sampled times"**: 14 steps apart from step 12, each half a step past its step and at least 5 steps from a commit,
  so a copy one step ahead of the other shows the same names.
- **"Naming the row"**: the row's `<set>#<key>`; **"naming the item"**: its ID; **"naming the grapheme"**: the grapheme
  and its code points; **"naming the entry"**: `{control, t}`; **"naming both seats"**: both seats' plates and what each
  shows; **"naming the player"**: the refusal row's `player`.
- **"A box sized for 10 of the widest glyph"** and **"a 16-letter name"**: 10 advances of W, and sixteen W (Fixtures);
  **"at a grapheme boundary"**: what is kept before the ellipsis is a whole number of the name's graphemes. The name is
  16 bytes, `max_bytes` 16, so its graphemes are single letters here; the Oracle lane cuts Unicode's own rows, where a
  cluster holds more than one code point.
- **"Latin fonts and no fallback for Han"**: the shipped look with no fallback faces, by asset; its body face, Inter,
  draws Latin and no Han. **"Fonts that draw both scripts"**: the shipped look (Inter draws Cyrillic too).
- **"The text keeps the seat's last committed name"** (criterion 8): `plate1` shows the NFC form of the last entry of
  `name` on the track, or the default before one, and holds no U+202E: whether the control commits 'Anaxyz' or nothing
  is the implementer's.
- **"Refused as blank"**, **"as mark_stack"**: the notice's `reason`; the strings are typed as one event each.
  **"Accepted"**: one entry holding exactly the typed bytes, no notice, and the text showing its NFC form. **"As one
  grapheme"**: the family emoji is one grapheme by the platform's segmenter, committed and shown whole, its joiner kept.
- **"A box that fits widest alone and not widest with ' (2)'"**: 105 u, beside the same piece at 158 u, which is
  presented, so the refusal is the fit check's, by the number.
- **"Refused alike on both copies"**: both copies' `refused` rows for `name` are equal and name player 2; what the
  copies then show is the seat's last name taken, "Ana", with one `sha256`.
- **"Lets a copy draw a missing glyph"**: a copy's shown string holds 字, which the look's faces can't draw.

## Not tested, because no criterion reaches it here

A template's `{entry: …}`; the fit check in other locales (the pieces carry one); the control's default as a range
member; Persian and Indic joins and the other direction controls (U+202A to U+202D, U+2066 to U+2069) and zero-width
characters other than U+200B; a mark stack of Me marks; skeletons at the pinned Unicode release beyond Latin and
Cyrillic; three or more seats; `entry.missing` for a player number a logic array writes; the entry's lookup cost. They
are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- The lanes line above.
- In the text module: entry texts on text items and mark-set text columns, their NFC display, the ` (n)` suffix by UTS
  #39 skeleton, the ellipsis at grapheme boundaries, the fit check with `widest` and the suffix, `widest` required,
  `entry.missing`, and the `player` binding's checks.
- In the text control: the range an entry text gives it, `hidden_character`, `blank` and `mark_stack`, with their notices.
- In `deep-show`: `eval`'s `shown`; `match`'s `refused` and its `render_back` rows' own-copy frames and `shown`;
  `track`'s `load` and `eval`'s `track` taking `player` and `writer: "peer"`; the nine planted names.

`BASE-FAILURE.txt` is the run at the base.
