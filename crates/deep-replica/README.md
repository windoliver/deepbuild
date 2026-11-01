# deep-replica

## What it is for

The replica (#338): a headless copy of the app on GPUI's virtual clock that checks run in, and the live capture that reads the real app's accessibility tree. Its binaries are `deep-replica` (a view's text snapshot and screenshot), `deep-live` (the live capture), `deep-drive` (#124, one replica an agent drives, started by packages/hub/src/drive.ts) and `deep-replica-canvas` (#806, the app's canvas panel connected to the hub). The render proof binaries and deep-show take their headless GPUI context from its library.

## Where new code goes

- `src/replica.rs`: the app headless as paired devices (#326) and the question card (#327). `src/shell.rs`, `src/snapshot.rs` and `src/kit.rs`: opening the shell, the text snapshot and the Needs you and notifier kits.
- `src/drive/`: deep_drive's locators, drawn-glyph reading and planted guards.
- One binary root per `[[bin]]` in `Cargo.toml`: `src/main.rs`, `src/live.rs`, `src/deep_drive.rs`, `src/canvas.rs`.
- Tests: `headless.rs` and `card_size.rs` at the crate root; `tests/drive.rs` drives `deep-drive`; blind acceptance suites stay in tests/acceptance/326 and 327.
- App views and state belong in deep-app; the replica only drives and reads them.

## What it may import

A tool beside the app: deep-app through its crate root, gpui-kit with `test-support` and gpui-shell, so the app binary itself carries no test support. AppKit (objc2) only on macOS, for the live capture. deep-app never imports it.

## Deviations

- `headless.rs`: no libtest harness, since AppKit needs the main thread for the offscreen Metal renderer; outside tests/ because preflight's perf run drops a change's own tests/ files, as with deep-app's screens suite.
- `card_size.rs`: outside tests/ and without the harness, for the same reasons as `headless.rs`.
- `Cargo.toml`: its `acceptance_326_*` and `acceptance_327_*` test targets point into tests/acceptance, where blind-written acceptance tests live and are never edited; this crate only builds them.
- `src/drive/plant.rs`: the wrong programs #124's criterion 2 fixture and #366's criteria 3 and 6 must catch, each lifting one guard, selected only by `DEEP_DRIVE_PLANT`.
- `src/live.rs`: the crate's `unsafe` is the Objective-C messages that ask AppKit for the window's accessibility children and frames.
