# deep-app

## What it is for

The macOS app shell on gpui-kit (issues #337, #338, #326, #327, #339, #105, #1172 and on): the window with its dock panels and shipped views, the menu-bar count, the question card with its arming and confirmation, notifications, setup, capture, and the canvas drawn from the canvas crates. It reads the record only from the hub's socket through one record reader. People run it; deep-replica and deep-gpu-layer build on it.

## Where new code goes

- One module per surface in `src/` (`card.rs`, `question.rs`, `views.rs`, `commands.rs` for ⌘K, `capture.rs` and so on), declared in `src/lib.rs`; new command-line modes go in `src/main.rs`.
- Hub calls go through `src/hub.rs`, and the record is read only through `src/record.rs`.
- Canvas text goes through deep-text-gpui (`src/text.rs`), never GPUI's text system, which stays for the chrome.
- Unit tests sit in a `#[cfg(test)]` module in the file; integration tests in `tests/`; pixel tests rendered offscreen in `screens.rs`.
- Brand assets live in the repo's `brand/` folder, listed in `brand/surfaces.json`; `src/brand.rs` embeds their bytes as they are.

- A view's `render` reads no fixture state, which `scripts/render-lint.mjs` holds (#1454). Installed views mount through `src/installed.rs`; the app's paired key and its signature are `src/device.rs`, and a card's answer leaves through `src/answer.rs`.

## What it may import

The app: the top of the stack. It may use the canvas crates (deep-canvas-marks, deep-canvas-cells, deep-text-gpui, deep-marks-gpui, deep-gpu, and deep-effects-render for the chrome operators, #1434) by crate name only, and talks to the hub over its socket, never by linking hub code. No core crate imports it. It sits outside `scripts/canvas-lint.mjs`'s and `scripts/text-lint.mjs`'s scope.

## Deviations

- `screens.rs`: a `harness = false` test target outside `tests/`, since AppKit needs the main thread and preflight's perf run drops a change's own `tests/` files, so this suite counts in its measured workload.
- `Cargo.toml`: the `acceptance_34` test target points at `tests/acceptance/34`, outside the crate; those tests are written blind and never edited here.
- `src/answer.rs`: under the `test-confirm` feature, in no shipped build, a file stands in for the OS's prompt, since an environment variable in the shipped app would let an agent answer for you (#1454).
- `src/states.rs`: the planted app #992 names reads `DEEP_HUB_PLANT` only in a build with the `env-plants` feature, which a release build refuses (#1408).
- `src/chrome_fixture.rs`: #1434's `chrome@1` fixture and the wrong programs `DEEP_CHROME_PLANT` selects, in no shipped build. It builds under the `chrome-fixture` feature, which unlike `env-plants` builds in release, since the budget run times a release build.
- `src/spike.rs`: #337's spike window, in no shipped build. It builds under the `spike` feature, through the crate's dev-dependency on itself, for the suites that keep #337's and #79's proof, and for the planted build #1172's suite opens.
- `panels/`: JavaScript panels that are test fixtures, not app code to tidy. `claude-code/` and `codex/` were written by each agent from `docs/spikes/337/panel-brief.md` and gpui-shell's docs alone; the `338-*` ones fill #338's slots, and `338-cap20`, `338-drop-folded`, `338-hide-newest` and `338-list-superseded` are planted faults the kit must name.
- `fixtures/quotes.json`: a synthetic seeded random walk recorded once, not market data; #337's panels read it, under the `spike` feature only, and the tests compute their expected values from the same recording.
- `src/trusted_input.rs`: `allow(deprecated)` on `CGDisplayCreateImageForRect`, since one frame of one rect is what the gate needs and ScreenCaptureKit and gpui's capture both stream.
