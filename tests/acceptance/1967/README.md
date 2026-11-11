# Acceptance tests for #1967: terminal recordings converted at import and played in a cell grid by t

Written first, from issue #1967 (as of Nov 10, 2026: its Scope, its Fields, its one acceptance criterion and its Proof
line), the design sections it links and those they lean on, and base commit `07b63844` ("Merge pull request #2257"),
by a job that never saw an implementation; none existed. No other branch, worktree or PR was read, and the oracle map
the issue links was not read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 1967 --repo windoliver/deepbuild`). Scope: "Terminal recordings as assets, converted
  at import in the decode worker by a pinned terminal emulator into a keyframe every second and row patches in flicks;
  a cell grid plays one by t and quotes it, and a command check's output recorded with times can be one". Fields:
  Asset `kind: … | terminal` "(a size, then output bytes with their times)", `probe: {terminal: {cols, rows: u16, span:
  flick, keyframes: u32}}`; cell grid `play: {asset: terminal recording, start: time, in: flick = 0, rate: rational =
  1}` "(optional, in place of `frame` and `patch`)". Its criterion is quoted under Criteria to tests.
- `docs/canvas-primitives.md`: Time and the flick (integer flicks, "Time to index floors", documents write `"1.25s"`);
  Honest numbers; Cell grid `cells@1` (Fields; Semantics: "A grid that plays a recording shows, at t, the keyframe at or
  before its source time plus the patches up to it, so seeking equals playing, and it quotes the recording"; "It can
  never: Draw a status color …"); Asset (probe once in the decode worker, the one checked read by hash,
  `asset_missing` / `asset_mismatch`); Asset: terminal recordings ("Converted once at import, in the decode worker, by
  a pinned terminal emulator into a keyframe of the whole grid every second and row patches stamped in flicks, so a cell
  grid plays it by t … and nothing parses escapes per frame"; "It can never: Be parsed in the frame loop or outside the
  decode worker; take keys or input; play without its hash"); Strip and track (source time = in + (t − start) × rate);
  Decode worker ("runs the asset probes, so … recordings are probed and decoded in a build without media").
- `docs/technical-design.md`: Films and figures on the canvas ("A terminal recording, such as the run that proved a
  change, plays in a cell grid on the film's clock"), the canvas modules table's `cells` row ("the cell grid and
  terminal recordings"), the Asset and Cell grid entries, the codecs paragraph ("hosted by the decode worker … so the
  data, scene3d and cells modules read assets without depending on media"), Dogfooding.
- At the base: AGENTS.md; `tests/acceptance/402/` (README, helpers, `cellgrid.test.ts`, `terminal.test.ts`: `install`,
  `terminal_open` with a timed `feed`, the `cells` and `cell` calls); `tests/acceptance/498/decode/` (`media_import`,
  `worker.pid`, the planted `decodes_in_app`); `tests/acceptance/499/video/` (an asset in the evidence store by hash,
  a document presented by `deep show`, `determinism`'s sides each carrying what an item shows); `tests/acceptance/1897/`
  (seek against play); in `crates/deep-show/src` `terminal.rs` (the live terminal and its replies), `media.rs`
  (`media_import`, `probe_assets`), `time.rs` (`determinism`: play warm, seek cold from a second later), `frames.rs`
  (`eval`, `cell_grids`); `crates/deep-canvas-cells/src/module.rs` (kind `cells@1`, its `play` param, the `cells.grid`
  operator, which reads only `frame`) and `emulator.rs`; `crates/deep-canvas-marks/looks/clean.json` and `look.rs`
  (the status colors, the terminal roles a live terminal draws with).

## What the base already does, and these tests don't credit

`deep-show run` opens live terminals in a plug-in's panel and feeds them recorded chunks on the virtual display clock,
answering `cells` and `cell` (#402); probes media files in a decode worker with `media_import` (#498); presents
documents and compares playing to seeking with `determinism`, whose sides carry a `video` block for video image items
(#488, #499). The cells module's kind lists a `play` param but its operator reads only `frame`: no grid plays a
recording, no asset is of kind `terminal`, and no reply carries a grid a document's cell grid shows.

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1967 --no-file-parallelism --testTimeout=900000
npx tsc -p tests/acceptance/1967/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file builds `deep-show` once in `beforeAll` with `cargo build --locked --bin deep-show` (`CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0`), copies it out of `target/debug` into a temporary folder, and fails each of its tests when
the build fails. Every evidence store and recording gets its own temporary folder, deleted after the test. Node
built-ins and vitest only; no network, no model, no real program in a terminal. A run with `--root` may leave Vitest's
cache in `tests/acceptance/1967/node_modules/.vite` or `.vitest`; delete it.

**It must run alone**: the files build cargo binaries, so `scripts/lanes.mjs` needs `'tests/acceptance/1967/'` in its
`alone` list (beside `402/` and `498/`). This job writes only this folder; the implementer makes that edit.

`determinism` renders each side canonically and hashes it on the GPU (#1897); with no GPU it answers
`gpu_unavailable`, and the tests that read it fail `BLOCKED:`, never pass. Everything else is deterministic: flick
times on the virtual clock, no wall time.

`BASE-FAILURE.txt` is the base run's output, trimmed: every test fails there for the missing behaviour.

## The surface under test

The issue names the asset, its probe and the grid's `play` field but no call. So these tests use the calls the base
already has (`media_import`, `deep show`, `determinism`, and #402's `install`, `terminal_open`, `cells`, `cell`) and
add the fewest fields the issue's Fields imply. **Every name below that the issue or the design doesn't give is this
job's choice**; the implementer builds exactly these, or a dispute goes to a blind redraft.

### The recording (`kind: terminal`: a size, then output bytes with their times)

A UTF-8 file of JSON lines:

- the first line is the size, `{"cols": u16, "rows": u16}`;
- each later line is one chunk of output in time order, `{"at": i64, "text": string}`: `at` in flicks from the
  recording's start, `text` the bytes the program wrote, as a JSON string of their UTF-8 text.

These are the `{at, text}` chunks #402's `terminal_open` takes as its `feed`, so "the same bytes" are the same chunks.
The span is the last chunk's `at`. The suite's recording, 20 × 4, with `\r\n` line ends as a terminal program writes
them (the tty turns `\n` into `\r\n`):

```text
{"cols":20,"rows":4}
{"at":352800000,"text":"\u001b[1;38;2;255;215;0;48;2;26;26;64mstep 1\u001b[0m\r\n"}
{"at":1058400000,"text":"\u001b[4;38;2;64;224;208mstep 2\u001b[0m\r\n"}
```

`step 1` at 0.5 s in bold, true-colour gold (`#ffd700`) on navy (`#1a1a40`); `step 2` at 1.5 s underlined in
turquoise (`#40e0d0`) on the default background. True colours draw as sent in any palette, and these lie over 0.2
OKLab from every status colour of the clean look (its status distance is 0.1), so neither the palette nor the
status rule moves them.

### `media_import` of a recording (#498's call)

`{"call": "media_import", "path"}` → `{"asset": {"sha256", "kind": "terminal", "probe": {"terminal": {"cols", "rows",
"span", "keyframes"}}, "decoder": {"name", "version"}}, "worker": {"pid"}}`: converted in a decode worker (whose
`pid` isn't deep-show's), `decoder` naming the pinned emulator. #498's planted `decodes_in_app` applies to it.

### The document

A board (`format: 1`, `profile: "board"`, size 320 × 200, `transport: {span: "3s", frame_rate: [30, 1]}`, `requires:
{modules: {cells: "^1"}}`) presented whole by `deep show` from your shell, with `assets: {rec: {sha256, license}}`
and one item, the cell grid `run`:

```json
{"kind": "cells@1", "at": {"pos": [16, 16, 0]},
 "params": {"size": {"cols": 20, "rows": 4, "cell": [8, 16]},
            "font": {"family": "mono", "size": 13, "fallback": [], "ligatures": false},
            "palette": {"fg": "ink", "bg": "ground", "ansi": ["term_black", "…", "term_bright_white"], "truecolor": true},
            "play": {"asset": "<the recording's SHA-256>", "start": "0s", "in": 0, "rate": [1, 1]}}}
```

The recording's bytes sit in the evidence store by their SHA-256 (`<store>/<first two hex>/<the rest>`), as #499's
video does; `play.asset` holds the SHA-256, as #499's image@1 `asset` does. The hub has the decode worker convert it
when the document is checked (#499's `probe_assets`). The palette names the look's roles a live terminal draws with
(#1003: ink, ground, and `term_black` … `term_bright_white` in ANSI order), so a cell left at the default colours
resolves to the same colour in both grids.

### `cells` on `determinism`'s sides (new)

Each of `play` and `seek` in #488's `determinism` reply gains, beside `pixels`, a block for every cells@1 item:

```text
"cells": {<item ID>: {"cols", "rows", "text": [string], "cursor": {"x", "y", "shape", "visible", "blink"},
                      "cells": [{"g", "fg", "bg", "attrs", "link"}]}}
```

the grid that item shows at that side's last time: `text` each row's graphemes, right-trimmed, as #402's `cells`
answers it; `cursor` as #402's `cells`; `cells` all cols × rows cells in row-major order, each as #402's `cell`
answers it (`g` the grapheme, `""` for a cell never written; `fg`, `bg` as `#rrggbb` as drawn; `attrs` the attribute
names; `link` a link ID or null). It is what the side's render (`pixels`) draws.

### Planted programs

Each reachable only through the scenario's `planted`, only to prove a test fails on a wrong program.

| Name | Where | The wrong program |
|---|---|---|
| `cells_play_every_patch` | deep-show scenario | a grid that plays a recording shows every patch of it whatever t: the recording's last grid at every time |
| `cells_seek_skips_patches` | deep-show scenario | a grid's seek (a session's first frame, or a frame earlier than the one before) shows the keyframe at or before the source time and none of the patches after it; playing forward applies each patch as its time is reached |
| `cells_patch_times_whole_seconds` | deep-show scenario (the import) | the import stamps each patch at its time rounded to the nearest whole second, halves up: `step 1` at 1 s, `step 2` at 2 s |

`decodes_in_app` is #498's, unchanged.

## Criteria to tests

AC1: "A terminal recording that prints `step 1` at 0.5 s and `step 2` at 1.5 s, played in a cell grid, shows only
`step 1` at 1.0 s and both lines at 2.0 s, the same cells whether played or seeked, and its grid at 1.0 s equals a live
grid fed the same bytes up to 1.0 s".

| Branch | Test | It fails on |
|---|---|---|
| only `step 1` at 1.0 s | `play.test.ts` "at 1.0 s the grid shows only `step 1`": played and seeked, rows `["step 1", "", "", ""]`, cursor (0, 1), `step 1`'s six cells bold gold on navy, the cell after it on the default background; the render at 1.0 s differs from 0.25 s's and from 2.0 s's | the base; `cells_play_every_patch` (shows `step 2`); a grid that draws nothing or everything (the renders) |
| both lines at 2.0 s | `play.test.ts` "at 2.0 s the grid shows both lines": played and seeked, rows `["step 1", "step 2", "", ""]`, cursor (0, 2), `step 2`'s cells underlined turquoise on the default background | the base; `cells_seek_skips_patches` (seeked, shows only the keyframe at 1 s) |
| the same cells played or seeked | `play.test.ts` "the same cells whether played or seeked": at each of nine times, the seeked grid equals the played one by every cell, row and cursor field, and the renders are equal; the grid differs between 0.25 s, 1.0 s and 2.0 s | the base; `cells_seek_skips_patches`, naming 2.0 s |
| prints at 0.5 s and 1.5 s, played by t | `play.test.ts` "the recording plays at its own times": rows and cursor at 0.25 s, 0.5 s − 1 flick, 0.5 s, 0.75 s, 1.0 s, 1.5 s − 1 flick, 1.5 s, 1.75 s and 2.0 s, both sides | the base; `cells_patch_times_whole_seconds`, naming 0.5 s and 1.5 s (it shows the right grid at 1.0 s and 2.0 s); a grid that shows a keyframe without its patches (0.75 s, 1.75 s); a seek from the keyframe after t (0.25 s) |
| equals a live grid at 1.0 s | `live.test.ts`: #402's terminal fed the chunks up to 1.0 s, read at 1.0 s after its output starts with `cells` and 80 `cell` calls, equals the recording's grid at 1.0 s, played and seeked, in size, rows, cursor and every cell | the base; any grid that differs in pen, rows or cursor: three more live terminals (the same text without its pen, the bytes up to 2.0 s, the same bytes then `ESC[1;5H`) differ from it under the same comparison, in cells only, in row 1, and in the cursor only |
| SCOPE (not a criterion): converted at import in the decode worker | `import.test.ts`: `media_import` answers kind `terminal`, the file's hash, probe `{cols: 20, rows: 4, span: 1,058,400,000, keyframes: 2}`, a decoder name and version, a worker pid that isn't the run's | the base; #498's `decodes_in_app` (the pid check) |

## Readings where the issue and design leave a choice

1. **The recording's format** is this job's: the simplest that a hand-written fixture produces and that fits "a size,
   then output bytes with their times": JSON lines, the size first, then `{at, text}` chunks in flicks, the same shape
   as #402's live `feed`. Times are flicks, not seconds, so no conversion rounds; output is UTF-8 text, which is all
   this criterion prints.
2. **Played or seeked** are #488's `determinism` sides, as #499 reads them for video: play evaluates every 144 Hz frame
   from 0 to t in one session, seek is a fresh session at t + 1 s and then t.
3. **"Shows"** is the new `cells` block, tied to the drawing: the render at 1.0 s must differ from the render before
   any output and from the render at 2.0 s, and seeking must render the same picture as playing.
4. **"The patches up to it" includes a patch stamped at the source time itself**, as #402's live terminal feeds a
   chunk whose `at` is the time read: at 0.5 s the grid shows `step 1`, one flick before it doesn't.
5. **More times than the criterion's two.** "Prints `step 1` at 0.5 s", "played in a cell grid" and the Semantics'
   keyframe-plus-patches rule fix what shows at every t, so the tests also read the edges of the two prints and a time
   inside each span. Without them a grid that rounds the times to whole seconds, or shows keyframes without their
   patches, would pass at 1.0 s and 2.0 s.
6. **Equal grids** are equal in size, each row's text, the cursor (place, shape, visibility, blink) and every cell's
   grapheme, colours, attribute names and link, as #402's `cells` and `cell` answer for the live terminal in a
   plug-in's panel. Bookkeeping (revision, vsync, scroll, modes) isn't compared; neither grid sets a title, cwd,
   progress or bell.
7. **"A live grid fed the same bytes up to 1.0 s"** is #402's terminal in a plug-in's panel, opened at 1 s with 20 × 4
   cells and fed the recording's chunks whose `at` is at most 1.0 s, at 3 s plus their `at`, read at 4 s.
8. **The probe**: `span` is the time of the last output (1.5 s), and `keyframes` counts one each whole second from 0 to
   the span (0 s and 1 s), so 2.
9. **The palette** names the look's roles a live terminal draws with (#1003), so default-coloured cells are equal in
   both grids; the true colours of the printed cells are palette-independent.

## Not tested

- "and quotes it, so honest numbers lists its digits as quotation", and "a command check's output recorded with times
  can be one": scope lines with no criterion. A document check that refuses the board for its digits would fail every
  test here at `deep show`.
- "Nothing parses escapes per frame" and "never parsed in the frame loop or outside the decode worker": no reply shows
  where the app parses; the import's process is checked (SCOPE) and the grid's times are, which rule out a grid that
  re-reads the file per frame only as far as it would draw the wrong cells.
- `start`, `in` and `rate` other than 0 s, 0 and 1: the criterion plays from the start at its own rate.
- `asset_missing` and `asset_mismatch` for a recording: the Asset entry's rule, not this criterion.
