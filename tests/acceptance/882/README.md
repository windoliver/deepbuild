# Acceptance tests for #882: app chrome draws every color from the look

These tests cover #882's four criteria: the look's guard with chrome roles (AC1), a lint-lane check on color literals in the app (AC2), the replica in dark (AC3) and the app's surface inventory (AC4).

They were written blind from issue #882 (its text as of October 31, 2026: Scope, the four criteria, Proof, Depends on), `docs/technical-design.md` (States people see; Panels and devices (trusted ring), with its Replica subsection; the canvas primitives' Look; the "Status colors where status shows" row; How we know version 0 works and its Dogfooding bullet) and the base commit `0f7fb686` (origin/main), where nothing of #882 is implemented. From the base I read `crates/deep-canvas-marks/src/look.rs` and `looks/clean.json` (the look and its guard), `crates/deep-marks-render/src/main.rs` (`deep-canvas-render look`, the guard's existing command), `crates/deep-app/src` (`views.rs`, `lib.rs`, `states.rs`, `brand.rs`, `card.rs` and every line with a color literal), `crates/deep-replica` (`src/lib.rs`, `src/shell.rs`, `src/main.rs`, `src/kit.rs`, `src/replica.rs`), gpui's test platform (`vendor/gpui-pre`: `WindowAppearance`, `TestWindow::simulate_appearance_change`, `HeadlessAppContext`), `scripts/lanes.mjs`, `scripts/record-reader-guard.mjs`, `scripts/repo-rules.mjs`, `scripts/proof-change.mjs` (`criterionId`), and the conventions of `tests/acceptance/326/panels`, `tests/acceptance/382` and `tests/acceptance/392`. No implementation of #882 was read. Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a blind redraft of this job.

## The surface (my choice where the issue names none)

### The look's chrome roles and its guard (AC1)

- **Where the roles live.** The chrome roles are entries of the shipped look's `roles` map (`crates/deep-canvas-marks/looks/clean.json`), beside its data roles, each naming a `palette` entry, with a theme's own `themes.<light|dark>.roles` over them, exactly as the data roles resolve today. A palette entry may be `#rrggbb` or `#rrggbbaa`.
- **Their names.** `ground`, `raised`, `divider`, `ink_primary`, `ink_secondary`, `ink_tertiary`, `ink_disabled`, `hover`, `selected`, `accent`, `session_readout` and `session_line`. `ground` and `accent` are the look's existing roles; the one ink is the existing `ink` role.
- **Their shape.** In each appearance: `ground`, `raised` and `ink` are opaque; each ink tier is `ink`'s color at an alpha, the four alphas strictly decreasing from primary to disabled; `hover` and `selected` are `ink`'s color at an alpha above 0 and at most 0.25; every opaque chrome role is at least 0.1 (OKLab) from every status color.
- **The guard** is the look's own (`look::resolve`), asked as the base already asks it: `deep-canvas-render look` (crate `deep-marks-render`), one JSON line in per look, `{"look": "clean"}` or `{"look": <look@1 definition>}`, one line out. #882 adds to its answers:
  - A look it passes: `{"ok": true, "look": <definition>, "roles": {"light": {<role>: <color>}, "dark": {...}}}`, every role of each appearance resolved to `#rrggbb` (opaque) or `#rrggbbaa`.
  - A role too near a status color: the base's refusal `{"ok": false, "code": "status_distance", "theme", "role", "state"}` plus `"distance"`, the OKLab distance as a number (0.0438 for `#b45309` against blocked `#a44700`; the test takes 0.044 ± 0.0005).
  - An ink tier under its floor: a refusal with `"ok": false`, the `"theme"` and the tier as `"role"`; its `code` is the implementer's.
- **Contrast**, as these tests compute it: WCAG 2.x, an alpha color blended over its surface in sRGB-encoded values. The surfaces are the ground, the raised ground, and hover over each of them. Floors: 4.5:1 for primary and secondary, 3:1 for tertiary, none for disabled.

### The color-literal guard (AC2)

- **Run as** `node scripts/color-literal-guard.mjs [--root <dir>]`. It checks the app under `<dir>/crates/deep-app` (the tests always put `crates/deep-canvas-marks/looks` beside it, from this branch). Without `--root` it checks the checkout it runs in.
- **What counts as a literal** (the tests' plants, all under `crates/deep-app/src`): `rgb(0x2563eb)` in `views.rs`; `hsla(0.6, 0.8, 0.5, 1.)` in a nested module, `src/planted_882/chip.rs`; `rgba(0x2563ebff)` in `lib.rs`; `const PLANTED_BLUE: u32 = 0x2563eb;` in its own module, used through `rgb(PLANTED_BLUE)` (the line named must be the constant's); a `"#2563eb"` string in `views.rs`. Plants are real modules, declared in the copy's `lib.rs`.
- **Output and exit.** Clean: exit 0, no line starting `FAIL`. Each literal: a line starting `FAIL ` naming `<path>:<line>` (path under the root, forward slashes, for example `FAIL color literal: crates/deep-app/src/views.rs:<line>: rgb(0x2563eb); use the role session_line`), and exit 1. For `views.rs`'s `rgb(0x2563eb)` the line also names, as a whole word, a role to use instead: one of the chrome role names above, `ink` or `muted`.
- **An exception** is a trailing comment on the literal's own line: `// color-literal-exception: <reason>; review <YYYY-MM-DD>`. With a reason and a review date it excepts that line. Without the review date it doesn't, and the same comment on another line excepts nothing.
- **Wiring.** The lane named `lint` in `scripts/lanes.mjs`'s `checks` has a command whose arguments end with `scripts/color-literal-guard.mjs`, with no `--root`, and runs on every change (no `paths`, or a `/**` path covering `crates/deep-app/src`). Run through `runLanes`, the plant in `views.rs` fails the lane as a line starting `FAIL lint:` naming `views.rs:<line>`.

### The replica in an appearance (AC3)

- `deep-replica --view <needs-you|session> --out <dir> --appearance <light|dark>`: the base's replica binary, with the appearance macOS reports set for its window (gpui's `WindowAppearance`). Without `--appearance` it draws as the replica does today, in macOS's default, light. It writes `screens/<view>.png` and `snapshots/<view>.json` under `<dir>` as at the base.
- **The judge** reads each PNG at 2x. Every color covering at least 32 device px as flat pixels (a pixel whose 8 neighbours share its color; text stems count at 2x) must be within 3 per channel of a color that appearance's roles give: an opaque role, a status color, or an alpha role over the ground, the raised ground, or hover or selected over either, blended in sRGB-encoded values or in linear light. The widest fill must be the ground or the raised ground, and at least 40 px must show some ink tier over one of those. A failure line starts with the view and the appearance, and names a fill that is the other appearance's role by that role (`... it is the other appearance's ground`).
- The snapshot must name the view's title (`Needs you`; `Session …`), so a screen that draws nothing can't pass.

### The inventory (AC4)

- `node scripts/app-inventory.mjs [--check] [--root <dir>]` reads the app under `<dir>/crates/deep-app` (default: the checkout) and writes `crates/deep-app/inventory.json`; `--check` writes nothing and compares the committed file with a fresh one.
- The file is `{"panels": [{"panel", "entry", "roles", "literals"}, ...]}`: one row per registered panel, `entry` a non-empty string, `roles` a list of role names, `literals` a list. The committed file has exactly one row for each of `deepbuild/sidebar`, `deepbuild/home`, `deepbuild/needs-you`, `deepbuild/session` and `deepbuild/line`.
- `--check`: exit 0 and no `FAIL` line when the two agree; otherwise exit 1 and a line starting `FAIL ` naming each panel whose row differs, is missing or is extra.
- A panel is added the way the shipped views are: the test inserts `register_panel(cx, "deepbuild/planted-882", |_, _, cx| Arc::new(cx.new(|cx| Shipped::new(Kind::Home, cx))));` as the first line of `views.rs`'s `register_views`. The script must see it by reading the source; the copy is never compiled.

## How to run

From the repo root (any Node from 23.9 up):

```sh
node --test tests/acceptance/882/look.test.mjs        # AC1; builds deep-canvas-render
node --test tests/acceptance/882/lint.test.mjs        # AC2; fast, no build
node --test tests/acceptance/882/replica.test.mjs     # AC3; builds deep-replica and deep-canvas-render; macOS only
node --test tests/acceptance/882/inventory.test.mjs   # AC4; fast, no build
node --test tests/acceptance/882/wrong.test.mjs       # the judges against wrong programs; passes at the base
```

- The `.mjs` files sit outside the unit lane's patterns (vitest's `*.test.ts`, and node's `tests/*.test.mjs`), as #326's guard tests do; the proof lanes run them as tagged tests.
- The builds are `cargo build --locked -p <crate> --bin <bin>`, copied to `/tmp/da882-bin-*` before use, since a sibling build can replace `target/debug`'s copy mid-run. A cold build of gpui-kit takes several minutes.
- `replica.test.mjs` needs macOS (the replica renders with Metal); elsewhere each test fails with `INCONCLUSIVE`. Set `DA882_SCREENS=<dir>` to keep the light and dark screenshots for the proof; otherwise they go to `/tmp/da882-screens-*` and are removed.
- Every test copies what it plants into `/tmp/da882-*` and removes it; nothing writes to the repo. `lint.test.mjs`'s base check reads `0f7fb686` with `git archive`.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed (`scripts/proof-change.mjs`, `criterionId`).

| ID | Criterion | Tests | Wrong programs it must fail on |
|---|---|---|---|
| `#882.98cbaa26` | AC1: The look's guard, run on the shipped look with the chrome roles, passes in light and dark; with the session readout's role set to `#b45309` it fails, naming the role, blocked and the distance 0.044 | `look.test.mjs`: `clean` passes, and its answer's roles hold the twelve chrome roles in light and dark in the shape above; with `session_readout` at `#b45309` in light (the one ink in dark) it is refused `status_distance`, light, `session_readout`, blocked, distance 0.044 ± 0.0005; with the readout in the one ink it passes; with `#b45309` in dark alone it is refused naming dark and `session_readout`. Scope: a light `ink_tertiary` in the ground's color is refused naming it and light | `wrong.test.mjs`, through `wrong/look-guards.mjs` on `fixtures/look-chrome.json`: the base's answer (no roles), a guard that checks data roles only, light only, one that leaves out the distance, one that refuses everything, one with no contrast check. Control: the same guard with no fault passes |
| `#882.f3bc7068` | AC2: `crates/deep-app/src` holds no color literal outside the look, and a planted `rgb(0x2563eb)` in `views.rs` fails the lint lane, naming the file, the line and the role to use; the merge base has 21 such lines and fails it | `lint.test.mjs`: no `rgb(0x`, `rgba(0x`, `hsla(`, hex inside `rgb(...)` or `"#rrggbb"` line in `crates/deep-app/src`; the guard passes a copy of the app and fails each of five plants naming `<path>:<line>` (the `views.rs` one with a role), passes a full exception, fails one without a review date and one placed on another line; the `lint` lane runs it and fails as `FAIL lint: ...views.rs:<line>`; at `0f7fb686` the app has exactly 21 `rgb(0x` lines and the guard fails, naming each and the two `hsla(` lines | `wrong.test.mjs`, the `wrong/lint-*.mjs` guards on `fixtures/app`: always passes, greps only `views.rs` (also fails the base judge), finds only `rgb(0x`, skips subfolders, names no line, names no role, ignores `--root`, an exception anywhere excepts the file, an exception needs no date. Lane tables: none, release only, another lane, paths that skip the app, `--root` elsewhere, a guard that never fails. Controls pass |
| `#882.218503b6` | AC3: With macOS set to dark, a replica (#124) of Needs you and a session page draws every chrome color from the dark roles, and every ink tier passes its contrast floor on ground, raised and hover; a build that keeps the light ground in dark fails, naming the view | `replica.test.mjs`: `--appearance dark` screens of `needs-you` and `session` pass the screen judge with the dark roles; `--appearance light` screens pass it with the light roles (the proof's light half); every ink tier keeps its floor on ground, raised and hover over each, in both appearances; the replica's own light screens, judged as dark, fail naming the view and the light ground | `wrong.test.mjs`: a made-up light-ground screen judged as dark fails naming the view and the light ground; a dark ground with the light appearance's ink fails naming the view; a tertiary ink under 3:1 on hover fails the ink judge. Control: a dark screen in the dark roles passes |
| `#882.c60566b1` | AC4: The inventory's check passes on this branch, and adding a panel without regenerating it fails, naming the panel | `inventory.test.mjs`: `--check` passes the checkout, and the committed file has a row per shipped panel; on a copy with `deepbuild/planted-882` registered, `--check` exits 1 naming it; after regenerating it passes and the file has the panel's row | `wrong.test.mjs`, the `wrong/inventory-*.mjs` scripts on `fixtures/app`: a check that always passes, an inventory of a fixed list, a check that names no panel, one that ignores `--root`, one that compares row counts only. Control passes |

## What the base commit has

At `0f7fb686` every tagged test fails, for a missing surface or the base's literals: `deep-canvas-render look` answers no `roles` and its `status_distance` refusal no `distance` (it does already refuse the planted readout, naming light, `session_readout` and blocked); `crates/deep-app/src` holds 24 literal lines by the AC2 scan; there's no `scripts/color-literal-guard.mjs` and no lane runs one; `deep-replica` refuses `--appearance`; there's no `scripts/app-inventory.mjs`. `wrong.test.mjs` passes, 35 of 35. `BASE-FAILURE.txt` holds the run.

## Assumptions a redraft may revisit

- **21 lines.** The issue counts 21 lines; its suggested grep (`rgb\(0x|hsla\(`) finds 23 at the base, the two extra being `show.rs`'s `hsla(` lines. 21 is the `rgb(0x` count, so the base check asserts that count and requires the guard to name all 23. `card.rs:185` (`rgb(if focused { 0x2563EB } ...)`) is a literal neither pattern finds; the AC2 scan counts it, so the branch must take it out too. `brand.rs`'s `INK` and `PAPER` constants and `crates/deep-app/panels/codex/main.js`'s `"#16803c"` aren't in the scan; the guard may flag them (the constant plant makes a `u32` hex constant a literal), and an exception or the look is the implementer's call.
- **The roles' home and names.** Pinning chrome roles to the look's `roles` map, the twelve names, and alpha as `#rrggbbaa` in the answer is my choice. A look that keeps chrome roles in a map of their own would fail these tests though it might meet the criterion.
- **How an alpha role's status distance is measured** isn't tested: an ink tier blended over the ground lands near idle (`#636464`) for some alphas, so a guard that measures blends may force alphas these tests don't. The opaque roles' distance is checked independently.
- **Hover on raised.** The ink floors are checked on hover over the ground and over the raised ground, since the sidebar's rows hover on raised.
- **The dark-only plant** may be refused for any reason that names dark and `session_readout`: on the dark ground `#b45309` also sits under 4.5:1, which a guard may count.
- **The replica's appearance** is a flag on the base's binary, not #124's `deep_drive`; #124's driver isn't at the base. Without the flag the replica stays light, which is what lets the last AC3 test stand in for "a build that keeps the light ground".
- **Gpui-kit's own chrome** (the dock's tab bars and borders, if they show) counts as app chrome: its colors must come from the roles too.
- **A registered panel** is a `register_panel` call in the app's Rust source. Script panels under `crates/deep-app/panels` aren't planted; the inventory may list them.
- **The inventory check** isn't required in a lane; the issue asks only for the check mode.
