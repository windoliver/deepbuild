# Acceptance tests for #358, criterion d4ccff93: state follows the element by key

Drafted blind from issue #358, `docs/technical-design.md`, `docs/canvas-primitives.md` ("Panel runtime and panel host"), gpui-shell's own docs at the pinned commit, and the base commit `244a3455`. The implementing agent doesn't edit them; a dispute goes to a blind redraft (design: Dogfooding).

Run: `node --test tests/acceptance/358/keys.live.test.mjs`. It needs a built host, so it is a `.live` test. Every test is tagged `#358.d4ccff93`.

## The surface (my choice, since the issue names none)

A **served panel check**: a subprocess that loads one test panel in the panel host, is driven with JSON lines, and answers from the materialized element tree.

### The record, `docs/spikes/358/keys.json`

```json
{
  "build":   { "command": ["cargo", "build", "-p", "<crate>", "--bin", "<bin>"] },
  "check":   { "command": ["target/debug/<bin>"] },
  "planted": { "command": ["target/debug/<bin>", "--match-by-position"] }
}
```

Commands run from the repo root. The tests run `build` once, then `check` and `planted`, each with `--panel <directory>` appended. Without the record, or when a command is missing, doesn't build or doesn't answer, each test fails with `BLOCKED:`.

### The planted host

`planted` must be a different command from `check`, and should be the same host and app code with one change: its reconciler matches old elements to new ones by their place among their siblings, not by key. It stays in the tree as a twin of the real reconciler. It must behave exactly as the real host does until a sibling's place moves: the tests hold it to every expected value for rebuilds 1 to 49.

### The panel

The tests write `<directory>/gpui-shell.json` and `main.js`, a real gpui-shell script with every key, height and row drawn per run. It uses gpui-shell's `View`, `div`, `v_flex`, `.id(key)`, `.h()`, `.overflow_y_scroll()`, `InputState` and `Input` from `gpui-base`, as gpui-shell's docs describe, and two things from DeepBuild's module `"deepbuild"`, which this spike adds:

- `rebuild_count()`: how many `rebuild` commands the host has taken, so the script is a pure function of it.
- `fold(key, header, body)`: a fold element. Its open state belongs to the host and follows `key`, since gpui-shell leaves a `Collapsible`'s state to the script, where no rebuild could lose it.

An element's **key** is its `.id(...)`. At rebuild 50 the script's tree gains one row in the list, at an index above the visible rows, and one notice element directly above the folds and the field. The panel is `agent_built` and runs in the panel host, whatever its manifest says.

### The commands

One JSON object per line on stdin, one reply per line on stdout. Nothing else goes to stdout; logs go to stderr.

First, unprompted, the check writes:

```json
{ "ready": true, "origin": "agent_built", "runtime": "panel_host", "matching": "by_key", "host_pid": 123, "check_pid": 122 }
```

`matching` is `by_position` for `planted`. `host_pid` is the panel host's process, not the check's.

| Command | What it does, as the user's input |
|---|---|
| `{ "cmd": "scroll", "element": key, "dy_px": n }` | A wheel scroll of the list by `n` logical pixels, positive down |
| `{ "cmd": "focus", "element": key }` | A click on the field, a gesture with a fresh serial |
| `{ "cmd": "fold", "element": key, "open": true }` | A click on the fold's header |
| `{ "cmd": "type", "text": s }` | Keystrokes into the focused element, at the caret |
| `{ "cmd": "caret_left", "count": n }` | Moves the caret left `n` characters |
| `{ "cmd": "compose", "text": s }` | An input method's marked text: replaces any current composition, leaves the value alone |
| `{ "cmd": "commit", "text": s }` | The input method commits: the composition ends and `s` goes in at the caret |
| `{ "cmd": "rebuild" }` | One invalidation: the script's `render` runs in the panel host, its element tree crosses to the app, and the app materializes and lays it out |
| `{ "cmd": "report" }` | The check's verdict so far |

Every reply is `{ "ok": true, ... }`. Anything else fails the test. Each reply except `report`'s holds the state read from the materialized tree after the command:

```json
{
  "ok": true,
  "host_pid": 123,
  "rebuilds": 50,
  "row_count": 1001,
  "scroll": { "anchor_key": "row-…", "offset_px": 12345 },
  "visible": [ { "key": "row-…", "text": "row-… 4242" } ],
  "focus_key": "field-…",
  "field": { "key": "field-…", "value": "abc", "caret": 2 },
  "composition": { "key": "field-…", "text": "かき" },
  "open_folds": [ "fold-…" ]
}
```

- `scroll.anchor_key` is the row at the top of the list's viewport, and `scroll.offset_px` the list's scroll offset. Scrolls are whole rows, so the anchor's top sits at the viewport's top.
- `visible` lists the rows the layout places in the viewport, top to bottom, each with the text it draws, a partly visible last row included.
- `focus_key` is the key of the focused element or its nearest keyed ancestor, or `null`.
- `field` is the field by its keyed wrapper. `value` holds committed text only, and `caret` counts Unicode scalars.
- `composition` is `null` when none is in flight, and must be present.

`report` replies `{ "ok": true, "verdict": "PASS" | "FAIL", "failures": [ { "rebuild": 50, "kind": "scroll" | "focus" | "caret" | "composition" | "fold", "element": "<key>", "expected": …, "actual": … } ] }`. The check takes a snapshot before each rebuild and compares by key after it: a scroll failure names the row that was the anchor, and a focus failure the element that held focus. When stdin closes the check exits, 0 on `PASS` and non-zero on `FAIL`.

## What the tests do

They keep their own model of the row order, the scroll, the value and the caret, and don't take the report's word for any of it.

The scenario: scroll to a drawn row of index 300 to 699, focus the field, open one fold; then for each of 100 rebuilds, scroll by one to three rows, type one character, and rebuild. The caret moves left three at rebuild 17. A composition starts before rebuild 48, changes before 49, and commits before 53, so it is in flight at 50. `planted` runs up to rebuild 50 only.

- **The real host**: every rebuild's anchor key, offset, visible rows and their text for that rebuild, focus, value, caret, composition and open folds equal the model; at rebuild 50 the anchor key holds and the offset grows by exactly one row; its report is `PASS`, exit 0.
- **The planted host**: all of the above through rebuild 49; at rebuild 50 the anchor is the row one above the old one at the unchanged offset, and focus is off the field; its report is `FAIL`, every failure at rebuild 50, a scroll failure naming the old anchor's key and a focus failure naming the field's key, exit non-zero.

Row text carries a salted number computed from the rebuild, so a tree that didn't come from the script at that rebuild doesn't match.
