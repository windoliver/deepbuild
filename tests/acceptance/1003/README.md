# Acceptance tests for #1003: the look guard checks every fill a row is drawn on, the terminal colors and a focus ring

These tests cover #1003's five criteria: the selected fill under an ink tier (AC1), a status color on the raised ground (AC2), the shipped looks, a look's 16 terminal colors and a program's own true color (AC3), the focus ring (AC4) and the screenshots with their one taste call (AC5).

They were written blind from issue #1003 (its text as of November 4, 2026: the problem, Scope, the five criteria, Proof, Depends on), `docs/technical-design.md` (States people see; Panels and devices (trusted ring), with its Cell grid and Replica subsections; How we know version 0 works and its Dogfooding bullet), `docs/canvas-primitives.md` (The status-color rule; the Look) and the base commit `e2e6e1cc` (origin/main), where nothing of #1003 is implemented. From the base I read `crates/deep-canvas-marks/src/look.rs` and `looks/*.json` (the look and its guard), `crates/deep-marks-render/src/{main.rs,lib.rs}` (`deep-canvas-render look`), `crates/deep-canvas-cells/src/{palette.rs,module.rs}`, `crates/deep-app/src/{cells.rs,chrome.rs,lib.rs,views.rs}`, `crates/deep-show/src/terminal.rs`, `crates/deep-replica/src/{main.rs,lib.rs,snapshot.rs}`, `scripts/proof-change.mjs` (`criterionId`), and the conventions of `tests/acceptance/882` and `tests/acceptance/402`. No implementation of #1003 was read. Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a blind redraft of this job.

## The surface (my choice where the issue names none)

### The guard

- The look's own guard (`look::resolve`), asked as the base asks it and as #882's tests do: `deep-canvas-render look` (crate `deep-marks-render`), one JSON line in per look, `{"look": "<shipped id>"}` or `{"look": <look@1 definition>}`, one line out; `{"list": "shipped"}` answers `{"ok": true, "shipped": [ids]}`. A look it passes answers `{"ok": true, "look": <definition>, "roles": {"light": {role: "#rrggbb" | "#rrggbbaa"}, "dark": {...}}}` as at the base.
- **Contrast** is WCAG 2.x, an alpha color blended over its surface in sRGB-encoded values and rounded to bytes, as the base's guard does.
- **The surfaces**, every fill a row can be drawn on, named exactly so in a refusal and checked in this order: `ground`, `raised`, `hover over ground`, `hover over raised`, `selected over ground`, `selected over raised`. Raised falls back to the ground, and hover and selected count only where the look gives them.
- **Ink tiers** keep the base's floors on all six: 4.5:1 for `ink_primary` and `ink_secondary`, 3:1 for `ink_tertiary`, none for `ink_disabled`. Refused as the base already refuses: `{"ok": false, "code": "ink_contrast", "theme", "role": <tier>, "on": <surface>, "ratio"}`.
- **Status colors** keep 3:1 on all six, in every theme (or are held by the look's `status_treatment.outline`, as the base allows). Refused as the base already refuses: `{"ok": false, "code": "status_contrast", "theme", "state", "against": <surface>}`.

### The look's terminal colors (AC3)

- Sixteen roles in the look's `roles` (with `themes.<light|dark>.roles` over them, as every role resolves), each naming an opaque palette entry, by ANSI index: `term_black`, `term_red`, `term_green`, `term_yellow`, `term_blue`, `term_magenta`, `term_cyan`, `term_white` (0 to 7), then `term_bright_black` (8, bright black), `term_bright_red` … `term_bright_white` (9 to 15). The terminal's background is the role `term_background`, or the ground where a look has none. These are the names a `cells@1` palette's `ansi` list can name.
- Each keeps 3:1 against the terminal background in each theme. Refused naming the color: `{"ok": false, "theme", "role": <its term_ role>, "ratio"}`, `code` the implementer's.
- The app's look, `clean`, gives all sixteen in light and dark. Another shipped look need not; one that gives any is held to all sixteen.
- **A program's own colors** are observed through #402's `deep-show run` (its README: Terminals): `terminal_open` with a recorded `feed`, on a session's page (`session`, where status shows) and in a plug-in's panel (`panel`, through a `cells` component), then `{"call": "cell", "terminal", "x", "y"}`, which answers `{"g", "fg": "#rrggbb", "bg": "#rrggbb", ...}` for the cell as drawn. The program sends `ESC[38;2;r;g;bm ESC[48;2;r;g;bm` pairs at 1.5:1 (`#2c2c2c` on `#000000`, `#2a2c66` on `#0c0c2a`), both colors 0.19 OKLab from the base's status colors and checked to keep 0.1 from the shipped clean look's; `fg` and `bg` must come back exactly as sent.

### The focus role (AC4)

- One role named `focus`, opaque or the ink at an alpha, in each theme of a look with chrome roles. It keeps 3:1 on all six surfaces, so a focused row (on raised, or hover over raised) reads beside a selected one (selected over raised). No criterion here reads a picture: "told apart by the focus ring at 3:1" is the guard's answer and the ratios these tests compute from the resolved roles.
- A look with no `focus` is refused naming it: `"role": "focus"`, or a `path` that names `focus` (the base's `bad_look` shape, such as `roles/focus (light)`). Under 3:1: refused with `"role": "focus"`, the theme, and `"on": <a surface it is under 3:1 on>`.

### The planted looks

All plants start from `fixtures/look-1003.json`: the base's clean look with the terminal roles and focus above, its status colors darkened and its dark theme equal to its light one. That is what lets every status color keep 3:1 on every fill while a selected fill drops the secondary ink: with a genuinely dark dark theme a status color must be light enough to read on it, and then any selected fill dark enough to drop the secondary ink under 4.5:1 drops the status colors under 3:1 first, so the refusal could rightly name a status. The fixture itself passes every rule above (checked by the control test), so a plant's refusal is for the plant alone.

| Plant | Change | What it breaks, and only that |
|---|---|---|
| AC1 `selected` | light `selected` → `#1b1d223c` | `ink_secondary` 4.40:1 on selected over raised (4.77:1 on selected over ground; tertiary keeps 3.16:1) |
| AC2 `blocked` | `status.blocked` → `#dc6c00` | blocked 3.39:1 on the ground, 2.90:1 on raised (and below it on hover and selected over raised, which come after raised) |
| AC3 `brightBlack` | dark `term_bright_black` → `#b7b7b7` | 2.01:1 on the terminal background (white) |
| AC4 `noFocus` | no `focus` | the focus role is missing |
| Scope `faintFocus` | light `focus` → `#8079f2` | 2.84:1 on hover over raised, 2.76:1 on selected over raised |

### The screenshots and the taste call (AC5)

- The replica takes four screens at the reference window (1512 × 982 points at 2×): `deep-replica --view sidebar --out <dir> --appearance <light|dark> --selected-row 0 --focused-row 1` (the sidebar with its first row selected and its second focused, the ring drawn), and `deep-replica --view terminal-colors --out <dir> --appearance <light|dark>` (the clean look's 16 terminal colors on its terminal background). Each writes `screens/<view>.png` and `snapshots/<view>.json` under `<dir>`, as the replica does today. Both flags and the `terminal-colors` view are new.
- The test checks only what needs no eye: each PNG is 3024 × 1964 and each snapshot's window is `{"size": [1512, 982], "scale": 2}`.
- **The taste call** is `docs/evidence/1003/taste.json`: `{"verdict": "right" | "wrong", "by": <who>, "at": "YYYY-MM-DD", "screens": {"light/sidebar.png": <SHA-256>, "dark/sidebar.png": ..., "light/terminal-colors.png": ..., "dark/terminal-colors.png": ...}}`, written by the person after seeing the screens. Without it, or when its hashes aren't this run's screens, the test fails `INCONCLUSIVE: ...`; with `wrong` it fails; it passes only with `right` on exactly these pictures. Set `DA1003_SCREENS=<dir>` to keep the screens for the PR and the session (the failure message prints their hashes).
- Attaching them to the PR and showing them in the session is the delivery's to do; no test can see it.

## How to run

From the repo root:

```sh
node --test tests/acceptance/1003/look.test.mjs      # AC1-AC4; builds deep-canvas-render
node --test tests/acceptance/1003/cells.test.mjs     # AC3's true color; builds deep-show
node --test tests/acceptance/1003/replica.test.mjs   # AC5; builds deep-replica; macOS only
node --test tests/acceptance/1003/wrong.test.mjs     # the judges against wrong programs; passes at the base
```

- The builds are `cargo build --locked -p <crate> --bin <bin>`, copied to `/tmp/da1003-bin-*` before use, since a sibling build can replace `target/debug`'s copy mid-run.
- `replica.test.mjs` needs macOS (the replica renders with Metal); elsewhere it fails with `INCONCLUSIVE`.
- Every test works in `/tmp/da1003-*` and removes it; nothing writes to the repo.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed (`scripts/proof-change.mjs`, `criterionId`).

| ID | Criterion | Tests | Wrong programs it must fail on |
|---|---|---|---|
| `#1003.29de0e96` | AC1: A planted look whose selected fill drops the secondary ink under its floor is refused, naming the role and "selected over raised"; the merge base accepts it and fails | `look.test.mjs`: the `selected` plant is refused `ink_contrast`, light, `ink_secondary`, on `selected over raised`, ratio 4.40 ± 0.05. Control: the fixture passes | `wrong.test.mjs`, `wrong/look-guards.mjs`: the base (accepts it), a guard with no selected surface, one that names `selected`. Control passes |
| `#1003.29e7223e` | AC2: A planted look whose blocked color keeps 3:1 on the ground but 2.9:1 on the raised ground is refused, naming the state and the surface; the merge base accepts it and fails | `look.test.mjs`: the `blocked` plant is refused `status_contrast`, blocked, against `raised` | the base, a guard that holds status colors on the ground only |
| `#1003.5c4fd8c1` | AC3: Every shipped look passes, in light and dark; a planted look whose bright black is 2:1 on the terminal background is refused, naming the color; a program that sets its own true-color text at 1.5:1 is drawn exactly as sent | `look.test.mjs`: every listed shipped look passes, and its resolved roles hold every ink floor and status 3:1 on all six surfaces, terminal roles 3:1 on the terminal background (all sixteen in `clean`, light and dark) and focus 3:1; the `brightBlack` plant is refused naming dark, `term_bright_black`, ratio 2.01 ± 0.03. `cells.test.mjs`: the 1.5:1 pairs come back as sent on a session's page and in a panel | the base, no terminal check, a refusal naming `ansi_8`, one without the ratio; a guard that passes a shipped look on its word (the shipped judge computes the miss); an app look without terminal roles or focus. Cells: a terminal that raises the text, a page that moves the background, a missing cell |
| `#1003.4b14acdc` | AC4: With a row selected and another focused, both are told apart by the focus ring at 3:1; a planted look with no focus role is refused | `look.test.mjs`: `clean`'s focus keeps 3:1 on all six surfaces in light and dark; the `noFocus` plant is refused naming focus; Scope: the `faintFocus` plant is refused naming focus and a surface it is under 3:1 on | the base, a guard where focus is optional, one that names the wrong surface |
| `#1003.2565997a` | AC5: Shown to you: screenshots of a selected row beside a focused row with its ring, in light and dark, and a look's 16 terminal colours, taken by the check run from the app at the reference window, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it | `replica.test.mjs`: the four screens at the reference window, then the taste call: INCONCLUSIVE without a matching one, FAIL on `wrong`, PASS on `right` | `wrong.test.mjs`: no record, a call on other pictures, one that leaves a picture out, no verdict, a verdict of its own, no one behind it, not JSON (all INCONCLUSIVE), `wrong` (FAIL); a screen at another size |

## What the base commit has

At `e2e6e1cc` every tagged test fails but the true-color one: `deep-canvas-render look` accepts all five plants (`"ok": true`); the shipped clean look has no terminal roles and no focus, and in dark its status colors fall under 3:1 on raised, hover and selected (for example pass at 2.31:1 on selected over raised); `replica.test.mjs` is INCONCLUSIVE on this Linux machine. The true-color test passes at the base: a cell already draws a color far from the status colors as sent. `wrong.test.mjs` passes, 32 of 32. `BASE-FAILURE.txt` holds the run.

## Assumptions a redraft may revisit

- **The role names** (`term_*`, `term_background`, `focus`), their home in the look's `roles`, and the terminal refusal's fields are my choice. A look that keeps terminal colors as a list would fail these tests though it might meet the criterion.
- **The fixture** darkens the status colors and makes dark equal light, so each plant breaks one rule; a guard that also requires dark to be darker than light, or the status colors to keep a distance from each other, would refuse it.
- **Surface order.** AC2's plant is under 3:1 on raised and on hover and selected over raised; the test wants `raised`, the first of them in the pinned order.
- **Which theme.** AC1's and the scope plant are light only; AC3's is dark only; AC2's blocked is shared, so either theme may be named.
- **True color** is checked on a session's page and in a panel with colors far from any status color, so the status rule can't move them; a color inside the status distance on a session's page is the status rule's to move (canvas primitives: The status-color rule), which this issue doesn't change. The test passes at the base.
- **The replica's flags and view** for AC5 are new surfaces I pinned; the issue names no command. Whether the sidebar's first two fixture rows exist, and what the terminal-colors view shows, is the implementer's.
- **The taste record** is a file the person writes; requiring its hashes to match this run's screens assumes the replica draws the same pixels each run on one Mac.
