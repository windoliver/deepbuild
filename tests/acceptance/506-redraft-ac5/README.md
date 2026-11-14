# Blind redraft of #506 criterion 5's last clause: the card's close button

Written from issue #506 (read live), the design sections it links and base commit `ef869ad87` ("Merge pull request
#2321 …", main), by a job that never saw an implementation, a plan, a diff or anyone's notes for this issue. It redrafts
one test of the issue's first blind suite (`tests/acceptance/506/`, commit `7994bd377`, read for its conventions and the
surfaces it invented): criterion 5's last clause, "its close button is reached by Tab and closes the card on Enter".
The implementing agent doesn't edit these files (AGENTS.md, Proof; technical design, Dogfooding).

## What was read

- Issue #506, live (`gh issue view 506 --repo windoliver/deepbuild`): Scope ("Cards over 3D"), the Overlay field block
  (`overlay.frame@1 {frame: ID}`), criterion 5.
- `docs/canvas-primitives.md`: Overlay (4585–4607: "A frame's controls join the Tab order like any others"; an overlay
  anchored to an item's point draws on top of the scene at that point's projection) and Control (5564–5589: `toggle`,
  `class: view` changes session state only, `binds`, `handle`, "Enter while it has focus").
- `docs/technical-design.md`: Dogfooding (2658) and Proven on the base (2148). `AGENTS.md` (Proof).
- At the base, only to find the surfaces: `crates/deep-show/src/main.rs` (the `deep show`, `scope`, `input` and `view`
  calls), `input.rs` (`input`, `view`, `scope_reply`), `ring.rs` (`route`, `key_to`: a key goes to the named panel when
  no panel holds keyboard focus), `film_viewer.rs` (a film's viewer takes keys only for `profile: film`), `picks.rs`
  (`settle_focus`, `pick_key`), `hub.rs` (`show`, `shipped_look`, `look_of`), `snapshot.rs` (`prepare`, render-back on
  the CPU), `shared.rs` (`knows`, `drawable`); `crates/deep-canvas/src/scope.rs` (`stops`, `tab`, `focused_target`,
  the key arm: Enter or Return acts only on a focused pick target; `to_json`'s `focus`);
  `crates/deep-canvas-marks/looks/clean.json` (the shipped clean look's roles); `crates/deep-canvas-marks/src/scene.rs`
  (the kinds the 2D frame draws); `crates/deep-canvas/src/document/rules.rs` (the honest-numbers rule reads text items);
  `crates/deep-canvas-scene3d/src/scene.rs` (`overlay`); `scripts/proof-change.mjs` (`criterionId`).
- `tests/acceptance/506/README.md` (Surfaces this job invents) and its `helpers.ts`, `ac5-lamp-card.test.ts`;
  `tests/acceptance/504/helpers.ts` and `424/helpers.ts` for the scenario's process table and the PNG coding, copied.

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/506-redraft-ac5 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/506-redraft-ac5/tsconfig.json    # type-check
rm -rf tests/acceptance/506-redraft-ac5/node_modules/.vite
```

The file builds `cargo build --locked --bin deep-show --no-default-features --features full` once, in `beforeAll`,
honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0` and `NO_COLOR=1` unless set and
Homebrew's rustup first on `PATH`, and copies the binary into a temporary folder. The test writes its evidence store
into its own temporary folder, deleted after it; `deep-show run` is started by `spawnSync` and stopped only by its own
timeout. Gates: no cargo is `BLOCKED:` (a failed test, never a pass); off macOS, or where `view` replies
`unsupported_platform`, the test fails with a message starting `INCONCLUSIVE:`, since the room's pixels are drawn on
macOS's Metal device.

Like the first suite, this file builds cargo binaries and draws on the Metal device, so the implementer adds, beside
the other GPU suites in `scripts/lanes.mjs`, `alone.push('tests/acceptance/506-redraft-ac5/');`.

## The test

`ac5-close.test.ts`, one test, titled `AC5 #506.f7b7c9cf the card's close button is reached by Tab and closes the card
on Enter`. The ID is `#506.` and the first 8 hex digits of the SHA-256 of criterion 5's text, trimmed, white space
collapsed (`criterionId`), computed from the live issue. `twins.json` holds no planted program for it: a program that
ignores the clause fails its own assertions.

Two `deep-show run` scenarios, each `deep show` of the room from your shell into the panel `main` (640 × 360), then
calls on #383's virtual clock:

1. **Find the Tab count.** Tab, then `scope`, eight times: the scope's `focus` after each. Asserted: it is
   `close-card` within 8 presses; `tabs` is the first press that puts it there.
2. **Tab, then Enter.** `view`; Tab `tabs` times; `scope`; `view`; Enter (`{type: "key", key: "Enter"}`); `view`.
   Asserted, in order:
   - the room is presented (`outcome: "presented"`, no item skipped as `unknown_kind`) in both runs;
   - after the Tabs the scope's `focus` is `close-card`;
   - the view before any key shows at least 2,000 pixels of the card's background (within 2 code values of the role
     `accent`, #1aa3c8, on every channel);
   - the view with the close button focused still shows at least 2,000: Tab moves the focus and presses nothing;
   - the view after Enter shows none (0 pixels within 2 code values of `accent`).

Expected values: `focus` `"close-card"` within 8 Tabs; at least 2,000 card pixels before Enter and after the Tabs;
0 after Enter. The card's background is about 10,400 px at the panel's own scale (160 × 100 less the title's box,
the image and the button), so 2,000 is a floor that a card drawn at all clears; 0 is the clause: a closed card draws
nothing.

Wrong programs it fails: the base (it refuses the card's `overlay.frame@1`; past that, Enter acts only on a focused
pick target); a close button that isn't a Tab stop;
Enter that doesn't press the focused control; Tab that presses it; a view that doesn't draw the card at all; a press
that hides the button but leaves the card's frame drawn.

## The fixture (helpers.ts: roomDoc)

The criterion's card: "a card frame with a title, an image and a close button, anchored to a lamp" in a 3D room. A
whole scene document (one writer layer `main`, `seed: 506`, `requires.modules` scene3d, marks2d and effects, budget
class showpiece, `camera: cam`): a still perspective camera from (0.6, 1.4, 6) m toward (0.6, 0.9, 0), 50°; a warm grey
sky and a sun; a floor, the lamp (a 0.3 × 1.4 × 0.3 m box centred on (0, 0.7, 0)) and a sofa (2.4 × 1 × 0.9 m at
(0, 0.5, 2)) between it and the camera, in warm, unsaturated materials far from `accent`. The card:

- `card-frame`, a `frame@1` with box (0, 0, 160, 100) px, and its children `card-bg` (`rect@1`, the whole box, role
  `accent`), `card-title` (`text@1` "Reading lamp", font `body`, role `ink`), `card-image` (`image@1`, a 64 × 48 opaque
  PNG made by the test in a lamp shade's colors, at (12, 36), `fit: fill`, `alt`), `card-close` (`rect@1`, 16 × 16 px
  at (136, 8), role `ink`);
- `card`, `overlay.frame@1 {frame: card-frame, anchor: {item: lamp, point: [0, 0, 0]}, offset: [0, 0]}`;
- the envelope's `controls`: `close-card: {kind: toggle, class: view, label: Close, role: button, binds:
  [items/card/visible], default: true, handle: {item: card-close}}`.

**Roles and texts pass the base's checks.** The document names no look, so `deep-show` checks and draws it in its
shipped clean look, and every role it names is one that look holds (`accent`, `ink`); no text item holds a number or a
number word. (The first suite's room named the role `card`, which only its `deep-gpu` look held.)

**The card itself doesn't pass the base's deep-show, and can't.** Run at the base (`BASE-FAILURE.txt`), `deep show`
refuses the room with `module_missing` at `items/card/kind: overlay.frame@1`: the base's marks2d frame operator
refuses every kind it doesn't draw, and it doesn't draw `overlay.frame@1`. A scratch run showed the same refusal with
every 3D item taken out, so every document holding the criterion's card is refused there; only a document without
the overlay (not the criterion's card) is presented. This test keeps the card the issue names, so at the base it fails
at its first assertion on the room ("the room is presented"), and the parent's rule that each fixture pass the base
binary's validation can't be met for this clause. Separately, the base doesn't build `deep-show` at all (`BASE-FAILURE.txt`
item 1: `crates/deep-canvas-motion/src/cues.rs:841`), so the gate's base run fails in this file's build assertion
first.

## Surfaces used and invented

Used as they stand at the base: `deep-show run` (#393's scenario: `evidence`, `sessions`, `processes`, `panels`,
`docs`, `clock`, `calls`), `deep show` from a peer process (#96), the panel's scope (#383: `scope`, `input` with
`{type: "key", key}`), #504's Tab stops (each control's own UI is a stop, reported as `state.focus` by its ID; the scope
takes `"Enter"` and `"Return"` as one key), `view`'s snapshot `{sha256, w, h}` in the evidence store at
`<2 hex>/<62 hex>`, `overlay.frame@1 {frame, anchor: {item, point}, offset}`, `frame@1`, `rect@1`, `text@1`, `image@1`,
`camera@1`, `sky@1`, `light.sun@1`, `material@1`, `mark.box@1`, the envelope's `controls`.

Invented by #506's first suite and reused here unchanged (its README's numbering):

- **11. The card's close button** is the control `close-card` above, drawn by the frame's child `card-close`: a Tab
  stop as every control is, and Enter on it while it has focus presses it, which hides the card.
- **12. The card's image** is the frame's child `card-image`, `image@1 {asset: <sha256>, box, fit: "fill", alt}`, its
  bytes in the scenario's evidence store.
- **14. `deep-show run`'s `view`** renders the panel's 3D document with its overlays and its view-class control state.

Invented here: none. Implied by 14 and made explicit: `deep show` presents a scene document holding an
`overlay.frame@1` (the base refuses it, `BASE-FAILURE.txt`). One reading where the first suite left a choice: the key is sent as `"Enter"`, the criterion's
word, which the base's scope already takes beside `"Return"`.

## Readings where the issue and design leave a choice

- **"Closes the card"** is read off the panel's own picture: after Enter no pixel shows the card's background. The
  card's frame, title, image and button all go with it, since the toggle binds the overlay's `visible`.
- **"Reached by Tab"** is the scope's `focus` naming the control after some number of Tabs, at most 8 (the room has one
  control; the bound leaves room for stops an implementation adds before it).
- **Tolerance** for the card's color: 2 code values, the first suite's, against antialiasing and the look's coding.

## What this test doesn't cover

The rest of criterion 5 (the card over the sofa, on the lamp's projected point through the orbit, hidden behind the
camera) stays with the first suite's `ac5-lamp-card.test.ts`; Shift-Tab, Space, a click on the button, and the card
coming back.
