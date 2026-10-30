# Blind redraft of three #402 acceptance tests

A fresh run of #402's acceptance-test job, with the same inputs, redrafting three disputed tests (AGENTS.md, Proof;
technical design, Dogfooding). It saw no implementation and looked for none.

## What was read

- Issue #402 (as handed over): scope, Fields, the nine criteria.
- At base `46e622f8` plus the first-draft commit: AGENTS.md; this suite's `README.md` (the declared surface, the
  planted programs, "Readings where the issue and design leave a choice"), `helpers.ts`, `terminal.test.ts`,
  `cellgrid.test.ts` and `input.test.ts`; `tests/acceptance/305/REDRAFT-388.md` for the format. To check the
  replies the tests read, also `tests/acceptance/401/README.md` (`input`'s reply `serial`, `focus`) and
  `tests/acceptance/400/README.md` (`pop_out`'s reply `{"window"}` or `{"code"}`), and 401's `helpers.ts` constants
  (`A`, `B`, `SLOTS`, `LEAD`, `CHECK`). No other test file of the suite, no other ref, worktree or PR.
- `helpers.ts` and every existing file are unchanged. The only new files are the three redrafts and this one.

## The redrafts

### `terminal-redraft.test.ts`: "AC1 the same on the 60 Hz display …" (criterion: a terminal keeps up at 60 updates a second)

600 lines, one every 1/60 s from a recorded feed, into panel `screen` (cols 120, rows 36). Your click in the panel
(`input` down and up) gives the serial; `pop_out` onto B carries it; then `updates` and `cells`. It asserts:

- `terminal_open` answers `opened` (via `openedOf`) and the `pop_out` reply has no `code` and has a `window`;
- 600 updates, and `keepUpProblems` against B's frames (period 1/60 s, B's phase) is empty: each update presented in
  a B vsync of its own, no earlier than it can be current, at most one frame (plus latch and check) late, none
  dropped or merged, the revisions chained;
- the grid ends on the last 35 lines plus the empty row, and its `revision` is the 600th update's;
- the planted `terminal_30_per_second` fails the same check on B, with a sentence naming an update (dropped, never
  presented, sharing a frame, or more than one frame late).

### `cellgrid-redraft.test.ts`: "AC4 the same on the 60 Hz display, popped out onto B: one B frame for each patch" (criterion: a cell grid fed by a busy terminal's changes keeps up at 60 updates a second)

600 full-screen repaints (home, 36 rows each rewritten and cleared to the end, 60 a second), the same click, serial and
pop-out onto B. It asserts: 600 updates; `keepUpProblems` on B empty; every update's `rows` is 36; the grid text is the
last repaint; its `revision` is the 600th patch's; `drawn_by` is `cells@1`; the planted `cells_a_frame_late` fails on B
with a sentence naming an update "more than one frame" late.

### `input-redraft.test.ts`: "SCOPE a program that asked for bracketed paste, the mouse and focus events …" (scope: raw input as keys with press, repeat and release, text, paste, mouse, focus and resize)

Two reader programs (80 × 24) on real PTYs, each asking for 2004, 1000, 1006 and 1004. Click in A, `focus` says A,
`pointer` over A says `over: A`. Then through `seam`, in this order: key `a` press, repeat, release, text `é`, paste
`pasted text`, mouse down, mouse up; each reply's `reached` must be exactly `["panel:A"]`. Click in B, then
`terminal_resize` of TA to 100 × 30. It asserts:

- A's log holds, as one contiguous run, `aaé` + `ESC[200~pasted text ESC[201~` + `ESC[<0;x;yM` + `ESC[<0;x;ym` (same
  x and y, both at least 1): press and repeat send `a`, release sends nothing;
- A is not told `ESC[O` before or in that run, and is after it (your click moved focus to B); B's log before that
  click holds none of the keys, text, paste or mouse bytes; B's log holds `ESC[I`;
- A's size log starts `80x24` and ends `100x30`.

No planted program (the first draft had none for this test).

## How they differ from the first drafts

- **Wrong reply read (terminal and cell grid).** The first drafts took the pop-out `serial` from `const [press] =
  d.step([open, down, up])`, which is the reply of `terminal_open`, the first call, and has no `serial`. The serial is
  in the reply of the `input` press (401 README: "its reply's `serial` is the serial of your input in that panel"). The
  redrafts read it from the second reply, and check that the pop-out was not refused and opened a window, so a refused
  pop-out can't be read as "the panel on B".
- Terminal and cell grid: also assert the update count (600) and the grid's `revision` against the last update; the
  planted program's failure must name an update by a specific reason, not any sentence starting `update N`. The
  repaint row text is 46 characters (the first draft's `slice(1, 41)` was 40, the row text is otherwise the same
  shape).
- **Input.** The first draft asserted `a.startsWith('aaé')`. By the README, a program that asked for focus events gets
  `ESC[I` when its panel gains focus, and the test's own click in A gives A focus, so A may read `ESC[I` first. The
  redraft looks for the run `aaé …` as contiguous bytes, whatever came before. The first draft never moved the
  pointer, yet the README says the mouse goes to the panel under the pointer; the redraft moves it over A and checks
  `over`. It adds the `reached` check on each seam reply and the check that A isn't told it lost focus before your
  click in B, and that B read none of the input meanwhile. It gives `input` and `seam` calls the `at` the helpers
  give them, and waits 1 s after the programs are ready for the host to apply their mode requests (the mode request
  and the first byte could otherwise race). The paste, mouse, focus and resize expectations are the README's.

## Run

Type-check: `npx tsc -p tests/acceptance/402/tsconfig.json` (node 24.22.0 first on PATH): exit 0.

Base run (`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/402
--no-file-parallelism terminal-redraft cellgrid-redraft input-redraft`), 3 failed of 3, as the base has no
`terminal_open`, `install` or `serve`:

```
 × input-redraft.test.ts > SCOPE a program that asked for bracketed paste, the mouse and focus events receives each …
   AssertionError: deep-show serve accepts the setup (README: The surface under test); got {"ok":false,"code":"bad_input"}; stderr: 
 × cellgrid-redraft.test.ts > AC4 the same on the 60 Hz display, popped out onto B: one B frame for each patch
   AssertionError: a busy terminal opens and you click its panel: deep-show run answers the scenario ok (README: The surface under test); got {"ok":false,"code":"bad_input"}
 × terminal-redraft.test.ts > AC1 the same on the 60 Hz display, where each update has one frame to itself: popped out onto B, every update is in its own B frame, one frame late at most
   AssertionError: the terminal opens and you click its panel: deep-show run answers the scenario ok (README: The surface under test); got {"ok":false,"code":"bad_input"}
 Test Files  3 failed (3)   Tests  3 failed (3)
```

Not run: anything past the base. The planted-program checks, the byte order in A's log and the 1 s settle are read
from the README, not seen against an implementation. The run was started before one unused-variable fix in
`input-redraft.test.ts` (type-check only); the vitest result doesn't depend on it.
