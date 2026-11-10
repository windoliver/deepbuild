# Blind redraft of four #1003 look tests for #1458's ink floors

#1458 amends #1003's ink floors, with the owner's approval: every ink role but `ink_disabled` clears 4.5:1 on every fill #1003 lists, in light and dark, and `ink_tertiary` goes, so a look gives its ink at two tiers and disabled. The four tests below all start from `../fixtures/look-1003.json`, whose `ink_tertiary` is 3.59:1 on selected over raised (3.72:1 on raised) under the old 3:1 floor (`../README.md`, line 14). A guard that follows the amended rule refuses that fixture, and every plant built on it, for `ink_tertiary` first. So the control fails, and each refusal names the wrong role.

The fixture here, `look-1003-1458.json`, is that fixture with `ink_tertiary` and its palette entry `graphite_tertiary` removed (diff it). Nothing else changes. Each test first computes from the look's own roles that the fixture keeps every rule as amended, or that the plant breaks only its own rule at the ratio given (`amendedProblems` in `judge.mjs`). Then it asks the real guard, `deep-canvas-render look`, and the refusal must name the same fields as before. The plants and the expected answers are unchanged: bright black 2.01 ± 0.03, focus required, and focus under 3:1 refused naming that surface.

Inputs: issue #1003, issue #1458 (Scope bullets on ink and AC3), `docs/technical-design.md` (Dogfooding), `docs/canvas-primitives.md` (Look `look@1`: "text has two inks and disabled, every ink but disabled clears 4.5:1 on every fill"), `../` (the existing suite, whose helpers these tests import), and the base commit `2721ca7b`, where I read `crates/deep-canvas-marks/src/look.rs`. I looked at no other worktree, branch, PR or session.

| Old test (`../look.test.mjs`) | New test (`look.test.mjs`) | Amended rule | Wrong program it fails on (`wrong.test.mjs`) |
|---|---|---|---|
| the fixture look, which keeps every rule the README pins, passes the guard and resolves its terminal and focus roles | same title, on the redrafted fixture. The fixture keeps the ink at two tiers and disabled, every ink but disabled at 4.5:1 on all six surfaces, and every other rule. The guard accepts it and resolves the 16 terminal roles, `term_background` and `focus` in both themes | two tiers and disabled; 4.5:1 for each ink but disabled | a guard still on three tiers, which refuses a look with no `ink_tertiary`; a guard that refuses every look; the old fixture, which fails the computed half with `ink_tertiary` at 3.59:1 on selected over raised |
| `#1003.5c4fd8c1` a planted look whose bright black is 2:1 on the terminal background is refused, naming the color | same title. The plant breaks only dark `term_bright_black` (2.01:1). It must be refused naming `theme` dark, `role` `term_bright_black` and `ratio` 2.01 ± 0.03 | the fixture under the plant keeps 4.5:1 for each ink, so the refusal can only be for bright black | a guard with no terminal check; one that names `ansi_8`; one that leaves out the ratio |
| `#1003.4b14acdc` a planted look with no focus role is refused | same title. The plant breaks only focus, in both themes. It must be refused naming `focus` (`role`, or a `path` under roles) | as above | a guard that lets focus be missing |
| `#1003.4b14acdc` (scope) a planted look whose focus is under 3:1 on a surface is refused, naming focus and that surface | same title. The plant breaks only light focus: 2.84:1 on hover over raised and 2.76:1 on selected over raised. It must be refused naming light, `focus`, and one of those two surfaces | as above | a guard that names the ground whatever surface fails |

`wrong.test.mjs` also checks that every plant built on the old fixture breaks more than its own plant. This is the fault the redraft removes. The wrong guards are `../wrong/look-guards.mjs`, run on the redrafted looks. The three-tier guard is a wrapper around that file's control guard.

## Run

From the repo root:

```sh
node --test tests/acceptance/1003/redraft-1458/look.test.mjs    # the four tests; builds deep-canvas-render (crate deep-marks-render) once
node --test tests/acceptance/1003/redraft-1458/wrong.test.mjs   # the tests against wrong programs; no build
```

## At the base

All four tests pass at `2721ca7b`, and so does `wrong.test.mjs`; `BASE-FAILURE.txt` holds the one run. The base already implements #1003. It still holds `ink_tertiary` to 3:1 (`look.rs:49`), which is the old behaviour, but it skips a tier that a look doesn't give. None of these four plants touches the ink, so no test here reaches that floor. Each test is instead shown to fail on the wrong programs in the table. The 4.5:1 floor on a planted `ink_tertiary` is #1458's AC3, outside these four tests.

## Ambiguous

- **What counts as an ink role.** I read it as `ink` and every `ink_*` role. The fixture's `muted` (`#8b8f97`, about 3.2:1 on white) is a canvas role, the same as in the shipped clean look, so it is not held to 4.5:1. A #1458 guard that also holds `muted` would refuse this fixture.
- **A look that still gives `ink_tertiary`.** The fixture gives none, so these tests pass both on a guard that holds a given `ink_tertiary` to 4.5:1 and on one that refuses the role outright.
- **#1458's new `type`, `space` and radius roles.** The fixture gives none of them, because the amendment I was given covers the ink floors only. A #1458 guard that requires them in every look with chrome roles would refuse the control. I did not check whether the base's schema check would accept a look that gives them.
