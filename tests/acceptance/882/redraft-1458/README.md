# #882 redraft under #1458: two inks and disabled

Two tests of #882's suite, redrafted blind under #1458's amendment, which the owner approved. Inputs: issue #882, issue #1458's scope ("Text has two inks and disabled. Rather than raise `ink_tertiary`, which has one caller, it goes"; "Every ink role but `ink_disabled` clears 4.5:1 on every fill #1003 lists, in light and dark"), `docs/technical-design.md` (Dogfooding), `docs/canvas-primitives.md` (Look), `../` (this suite) and the base commit `2721ca7b`. The old files stay as they are; these replace the two tests below once swapped in.

Everything else the old tests assert is kept by importing it: the readout plant at `#b45309` refused `status_distance`, light, `session_readout`, blocked, distance 0.044 ± 0.0005; the one-ink control; the dark-only plant (`../look-judge.mjs`, `judgeLook`, its roles lines dropped); the surface (`deep-canvas-render look` and its `roles` answer, `../README.md`, The surface); the opaque roles' 0.1 OKLab distance; hover and selected as the one ink at alpha ≤ 0.25. The screen tests in `../replica.test.mjs` and the scope test in `../look.test.mjs` are unchanged.

| Old test | New test | Amended criterion | Wrong programs it must fail on |
|---|---|---|---|
| `../look.test.mjs`, `#882.98cbaa26` (AC1): twelve chrome roles, four ink tiers, alphas strictly decreasing primary → disabled | `look.test.mjs`, `#882.98cbaa26` | The shipped look's answer holds, in light and dark, `ground`, `raised`, `divider`, `ink_primary`, `ink_secondary`, `ink_disabled`, `hover`, `selected`, `accent`, `session_readout`, `session_line` and `ink`; no other role named `ink_*` (so no `ink_tertiary`, nor a third tier renamed); the three tiers are the one ink at alphas strictly decreasing primary → secondary → disabled. The rest as before | The base (keeps `ink_tertiary`); a third tier as `ink_muted`; secondary as strong as primary; dark's disabled above its secondary; no secondary; a guard that passes the `#b45309` readout (the kept plant) |
| `../replica.test.mjs`, `#882.218503b6`'s ink half: every ink tier passes its floor (`ink_tertiary` 3:1) on ground, raised and hover | `replica.test.mjs`, `#882.218503b6` | Every ink role (`ink` and each `ink_*`) but `ink_disabled` keeps 4.5:1 on ground, raised, hover over either and selected over either, in light and dark; `ink_primary` and `ink_secondary` must exist | The base (`ink_tertiary` at 3.50:1 on the light ground, 3.22:1 on selected over raised); a light `ink_secondary` at `#1b1d22a1`, 4.39:1 on selected over raised only (the old ground/raised/hover judge passes it); a dark secondary under 4.5:1; no secondary |

`wrong.test.mjs` runs both judges on those wrong programs (no build; the fixture look and `../wrong/look-guards.mjs`'s guard) and passes at the base. It tests the tests and carries no criterion tag.

## Choices a later reader may revisit

- **A third tier is any role named `ink_*`** beyond the three. The base has no other `ink_*` role.
- **Contrast** is WCAG 2.x, an alpha blended over its fill in sRGB-encoded values, as `../README.md` pins; selected over a fill is blended the same way as hover. "Every fill #1003 lists" is read as the brief gives it: ground, raised, and hover and selected over either. Other fills #1003 may list (terminal colors, focus ring) aren't tested here.
- **`ink` itself** counts as an ink role and is held to 4.5:1; it is the opaque one ink, so it passes wherever `ink_primary` does.
- The ink half stays in `replica.test.mjs` and reads the guard's resolved roles, as the old test did; it needs no screen.

## Run

From the repo root (Node 24; the tagged tests build `deep-canvas-render`, `cargo` on PATH):

```sh
node --test tests/acceptance/882/redraft-1458/look.test.mjs      # AC1
node --test tests/acceptance/882/redraft-1458/replica.test.mjs   # AC3's ink half
node --test tests/acceptance/882/redraft-1458/wrong.test.mjs     # the judges on wrong programs; passes at the base
```

`BASE-FAILURE.txt` holds one run of the two tagged tests at `2721ca7b`.
