# Acceptance tests for #990: terminal input: keys from the program's modes with modifiers, pastes that can't end early, answers to the queries programs wait on, and modes reset on exit

Written first, blind, from issue #990 (updatedAt 2026-11-04T19:39:00Z: its description, Scope, eight acceptance criteria
and Proof line), the design sections it links and those they lean on, and base commit `e2e6e1cc` ("Merge pull request
#1211 from windoliver/claude/issue-324-e6e855", origin/main), by a job that never saw an implementation; none existed.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

The issue has eight checkbox criteria, AC1 to AC8 in the body's order. Each test's name starts with its criterion's ID,
or with SCOPE for a Scope item no criterion covers.

What was read:

- AGENTS.md (the four invariants, Proof) and `docs/technical-design.md`: Panels and devices, Stream and raw input
  ("Raw input: keys (press, repeat, release), text, paste, mouse, focus and resize, from a panel you focused. It can never:
  Reach another plug-in, or come from an agent"), Cell grid ("Clipboard writes are shown and clipboard reads refused … It
  can never: Become evidence of an agent's state"); What each agent gives us, and the limits we design around, and its
  Hooks are evidence, not a state machine list, whose Program status bullet is the only place OSC 7501 is named ("lets a
  program tell its terminal it's working, blocked, done or failed … they're one more signal, never enough on their own for
  a claim or a verdict"); the readings of a session (`session.reading`, "the session shows a reading"); the reference Macs
  and the INCONCLUSIVE rule; Tests written first and Dogfooding.
- At the base: `crates/deep-show/src/serve.rs` (#402's `deep-show serve`: `Plant`, `key_bytes`, which sends Enter as CR
  whatever the modifiers and ignores application-cursor mode; the paste, wrapped without removing a marker inside; the
  mouse at a fixed 8 × 16; `terminal_open` only for a plug-in panel), `host.rs` (the panel host, which "has no way to write
  to the program"), `crates/deep-canvas-cells/src/emulator.rs` (the modes it keeps, no replies to queries, no reset) and
  `module.rs` (the cell grid's `font.size`); `tests/acceptance/402/` (README, helpers, input, clipboard, streams, session,
  BASE-FAILURE), `104/` and `989/` (hosted terminals, the supervisor's helper), `140/view/access.test.ts` (macOS
  accessibility and VoiceOver, live-only), `1174/taste.test.ts` (the taste call); `packages/record` (`session.reading`
  → `session_readings`, `record.session(id)` → `{status, readings}`, the hooks' state rules in `projections.ts`),
  `packages/verdicts` (`recordVerdict`), `packages/contracts` fixtures.

What the base already does and these tests don't credit: #402's `serve` runs programs on real PTYs with a panel host of
their own, routes seam keys, text, pastes and mouse to the focused panel, wraps a paste in markers when the program asked
for bracketed paste, reports SGR and X10 mouse, focus events and resizes, and refuses clipboard reads. The record keeps
`session.reading` events as a session's readings.

## Run them

```sh
npm ci                                   # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/990 --no-file-parallelism
npx tsc -p tests/acceptance/990/tsconfig.json   # type-check (never tsc -b at the root)
```

Every file builds `deep-show` once with `cargo build --locked --bin deep-show` (through #402's `useShow`), copies it to
`/tmp/dh402-bin-*`, and fails each test when the build fails. The tests start `deep-show serve` and, through it, real
programs on real PTYs: Node scripts the tests write (run with `process.execPath`), `bash` 5.1 or newer (AC2), and
`/bin/sh -i` (AC5). Each program gets a HOME of its own (a temp folder under `/tmp/dh402-*`), a minimal PATH and no
network; no test touches the real clipboard, and every process is stopped by the PID `serve` reported or by `serve`
itself when its stdin closes. `scripts/lanes.mjs` needs `tests/acceptance/990/` in its one-at-a-time list beside `402/`
(the files start PTYs, a shell and a hub each, and AC3 reads 50 ms); this README is the instruction, and the implementer
makes that edit. A run with `--root` may leave Vitest's cache in `tests/acceptance/990/node_modules/.vite`; delete it.

INCONCLUSIVE, never PASS and never a skip: a test that can't be judged on this machine fails with a message starting
`INCONCLUSIVE:`. That is AC7's VoiceOver test anywhere but the reference Mac (Mac15,7 or Mac15,12) with VoiceOver on and
`DEEP_990_LIVE=1` (a person is there); AC8 anywhere but the reference Mac, or without the owner's recorded taste call on
this run's pictures; AC2 where no bash 5.1 or newer exists; AC3's 50 ms bound when it is read over 50 ms off the
reference Mac (order and presence still fail hard everywhere).

## The surface under test

Everything goes through `deep-show serve` as #402's README defines it (setup line, then one call a line), plus:

- **Planted faults** (the setup's `planted`; an unknown value answers `bad_input`, as at the base):
  `shift_enter_bare_cr` (the encoder sends a bare CR for Shift+Enter, in every mode, and is right otherwise),
  `paste_keeps_end_marker` (a paste keeps an end marker inside its text), `queries_dropped` (the emulator answers no
  query), `status_sets_state` (each program-status reading also sets the session's state), `modes_left_on` (nothing is
  reset when a program exits or restarts), `ime_sends_composing` (marked text is sent to the program as it changes),
  `insert_dropped` (an inserted text is dropped), `insert_typed_straight` (an inserted text goes straight to the program).
- **Keys** (`seam`, `{"type": "key", "key", "phase": "press", "mods": [...], "code"?}`): key names `enter`, `tab`,
  `backspace`, `escape`, `up`, `down`, `right`, `left`, `f1`…`f12` or a character; mods `shift`, `alt` (Option), `ctrl`;
  `code` the physical key (W3C UI Events `code`: `Enter`, `ArrowUp`, `F5`, `KeyC`, …). The bytes follow the program's
  modes as the emulator holds them after every byte the program wrote before the key (AC1's table, in `keys.test.ts`).
  With Control, a key is matched by its `code`, whatever character the input source gives it.
- **Text from an input method**: `{"type": "preedit", "text"}` is marked text while you compose (an empty text ends it);
  `{"type": "text", "text"}` (#402) is committed text. `cells` gains **`preedit`**: `{"text", "x", "y"}` (the composition
  and the cell it is drawn at, the program's cursor cell even when the program hid its cursor) or `null`.
- **Text another app inserts** (dictation, text expansion: accessibility, not keys): `{"type": "insert", "text", "app"}`.
  `cells` gains **`box`**: `{"text", "source"}` (the session's box beside the grid; `source` names the app) or `null`. Your
  Enter (a key event) sends the box's text to the program, whole and once (a CR may follow it), and empties it.
- **Drawn cells**: `terminal_open` takes **`font`**: `{"size": points}` (the cell grid's `font.size`, default 13), and
  `cells` gains **`drawn`**: `{"x", "y", "w", "h"}` (window px: the grid's top-left and one cell's size as drawn).
  Mouse reports map a seam `pos` to a cell by these, not a fixed 8 × 16.
- **The session's terminal in `serve`**: `terminal_open` with `"session": ID` instead of `panel` (#402's README already
  names it for `run`), and the setup's `record`: program-status readings are written to that record as `session.reading`
  events of that session (so `record.session(id).readings` shows them, in order, after a replay of the log).
- **`{"call": "terminal_restart", "terminal", "program": {"argv", "env", "cwd"}}`** → `{"restarted": true, "program":
  {"pid"}}`: the host starts a new program on the same terminal and grid (Scope: "or the host restarts it").
- **macOS only** (elsewhere `{"code": "unsupported_platform"}`, which the tests read as INCONCLUSIVE):
  `{"call": "ax", "terminal", "focus"?: true}` → the terminal tab as the app's window gives it to accessibility,
  `{"role": "AXTextArea", "value": string, "line": row of the insertion point, "line_text": string}`; and
  `{"call": "screenshot", "terminal" | "session"+"part": "row", "path"}` → `{"from": "app", "sha256"?, …}`, a PNG of
  that part of the app's own window at the reference window, written to `path`.

### OSC 7501, the form assumed

The design names OSC 7501 and its four states but not its bytes, and this job reads no outside spec. The tests assume
the plain OSC form: the query is `ESC ] 7501 ; ? ST`; a report is `ESC ] 7501 ; <state> [; <text>] ST`, `<state>` one of
`working`, `blocked`, `done`, `failed` (the tests send `working`, `blocked;waiting on your review`, `done`, each ended by
`ESC \`). Any answer to the query that starts `ESC ] 7501 ;` and ends with BEL or ST counts as answered. A reading
counts as a report's when its text holds the report's state as a word. If the published form differs, that is a
dispute for a blind redraft, not an edit.

### AC1's table, the choices made

Kitty keyboard protocol rows follow the spec as cited in `keys.test.ts` (flag 1: unmodified Enter, Tab and Backspace stay
legacy, everything else `CSI … u` / `CSI 1 ; m X` / `CSI n ; m ~`, F3 `CSI 13 ~`, no SS3; flag 8 in 31: Enter, Tab,
Backspace too; a press's event type and absent alternates and text left out). Normal and application-cursor rows follow
xterm: SS3 for unmodified arrows only in application-cursor mode, SS3 P–S for unmodified F1–F4, `CSI 1 ; m X` and
`CSI n ; m ~` with modifiers. For modified Enter, Tab and Backspace without keyboard flags the table takes xterm's
modifyOtherKeys form `CSI 27 ; m ; code ~`, except two forms every shell already reads: Shift+Tab is `CSI Z` (backtab)
and Option alone is ESC before the key's byte (Meta). So Shift+Enter is `CSI 27 ; 2 ; 13 ~` in normal mode.

## The files

| File | Criterion | Tests |
|---|---|---|
| `keys.test.ts` | AC1, SCOPE physical keys | the table's spot rows; the 532-press matrix in four modes; `shift_enter_bare_cr` fails naming Shift+Enter and the mode; Control+с/в under a Russian layout send ^C/^D |
| `paste.test.ts` | AC2, SCOPE no marker | bash keeps the whole paste at its prompt, runs nothing, the planted folder stays; `paste_keeps_end_marker` deletes it and fails naming the paste; no marker into a program without bracketed paste |
| `queries.test.ts` | AC3, SCOPE answers before keys | six answers in order in 50 ms, the clipboard read unanswered, the colors the terminal's own; `queries_dropped` prints "timeout" and fails naming the first query; a key typed right after the queries arrives after the answers |
| `status.test.ts` | AC4 | the query answered, three readings in order on alpha's row, state (waiting) and verdict unchanged; `status_sets_state` fails naming the reading |
| `modes.test.ts` | AC5, SCOPE restart | after a program exits, `sh` reads a paste, a click, Up and Escape as plain bytes, main screen back; `modes_left_on` fails naming bracketed paste; the same after `terminal_restart` |
| `ime.test.ts` | AC6, SCOPE drawn cell size | the composition at the hidden cursor's cell, 你好 sent once; `ime_sends_composing` fails; clicks by the drawn cells of 13- and 20-point terminals |
| `access.test.ts` | AC7 | the 200-character insert in the box naming the app, sent once on Enter; `insert_dropped` and `insert_typed_straight` fail; VoiceOver (live, reference Mac) |
| `taste.test.ts` | AC8 | two screenshots from the app, and the owner's call in `TASTE.json` (as #1174's: `issue`, `criterion`, `verdict` `looks_right`/`looks_wrong`, `who`, `when`, `screenshots` by name → SHA-256) |

`BASE-FAILURE.txt` is the run at the base, with why each test fails there.

## The live runs and the taste call

AC7's VoiceOver test: at the reference Mac, VoiceOver on (⌘F5), "Allow VoiceOver to be controlled with AppleScript" on,
`DEEP_990_LIVE=1`. AC8: on the reference Mac the run writes `target/acceptance/990/composition-at-cursor.png` and
`session-row-readings.png` and prints their SHA-256; attach them to the PR, show them to the owner in the session, and
record the one call in `tests/acceptance/990/TASTE.json` with those hashes. A call on other pictures, or none, stays
INCONCLUSIVE.
