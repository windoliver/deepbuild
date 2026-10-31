# deep-app

## What it is for

The macOS app shell on gpui-kit (issues #337, #338, #326, #327, #339, #105 and on): the window with its dock panels and shipped views, the menu-bar count, the question card with its arming and confirmation, notifications, setup, capture, and the canvas drawn from the canvas crates. It reads the record only from the hub's socket through one record reader. People run it; deep-replica and deep-gpu-layer build on it.

## Where new code goes

- One module per surface in `src/` (`card.rs`, `question.rs`, `views.rs`, `capture.rs` and so on), declared in `src/lib.rs`; new command-line modes go in `src/main.rs`.
- Hub calls go through `src/hub.rs`, and the record is read only through `src/record.rs`.
- Canvas text goes through deep-text-gpui (`src/text.rs`), never GPUI's text system, which stays for the chrome.
- Unit tests sit in a `#[cfg(test)]` module in the file; integration tests in `tests/`; pixel tests rendered offscreen in `screens.rs`.
- Brand assets live in the repo's `brand/` folder, listed in `brand/surfaces.json`; `src/brand.rs` embeds their bytes as they are.

## What it may import

The app: the top of the stack. It may use the canvas crates (deep-canvas-marks, deep-canvas-cells, deep-text-gpui, deep-marks-gpui, deep-gpu) by crate name only, and talks to the hub over its socket, never by linking hub code. No core crate imports it. It sits outside `scripts/canvas-lint.mjs`'s and `scripts/text-lint.mjs`'s scope.

## Deviations

- `screens.rs`: a `harness = false` test target outside `tests/`, since AppKit needs the main thread and preflight's perf run drops a change's own `tests/` files, so this suite counts in its measured workload.
- `Cargo.toml`: the `acceptance_34` test target points at `tests/acceptance/34`, outside the crate; those tests are written blind and never edited here.
- `panels/`: JavaScript panels that are test fixtures, not app code to tidy. `claude-code/` and `codex/` were written by each agent from `docs/spikes/337/panel-brief.md` and gpui-shell's docs alone; the `338-*` ones fill #338's slots, and `338-cap20`, `338-drop-folded`, `338-hide-newest` and `338-list-superseded` are planted faults the kit must name.
- `fixtures/quotes.json`: a synthetic seeded random walk recorded once, not market data; the panels read it and the tests compute their expected values from the same recording.
- `src/trusted_input.rs`: `allow(deprecated)` on `CGDisplayCreateImageForRect`, since one frame of one rect is what the gate needs and ScreenCaptureKit and gpui's capture both stream.
