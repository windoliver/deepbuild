# #142: film recipes as the canvas draws them

Criterion 12 (`#142.0815c532`) asks for screenshots of each film recipe's example in 2D and 3D, the kinetic-type
slam and the explain.linear_map shear, taken by the check run from the canvas's own frames, with a recording of one
example film and of the shear, and one taste call on them. These 23 files are
`tests/acceptance/142/ac12-taste.test.ts`'s own output on this branch, with `DEEPBUILD_EVIDENCE_DIR` set to this
folder: `deep-show`'s `eval` snapshots, kept byte for byte and named by their SHA-256, and the two recordings put
together from `deep-show`'s frames at 30 fps, unchanged.

| What | Files |
|---|---|
| Each example on the 2D stage (ten) and the 3D stage (nine; explain.linear_map is 2D only) | `<recipe>-2d-….png`, `<recipe>-3d-….png` |
| The kinetic-type slam | `kinetic-slam-….png` |
| The explain.linear_map shear | `linear-map-shear-….png` |
| The kinetic-type example played at 30 fps | `kinetic-type-….apng` |
| The shear played at 30 fps | `linear-map-shear-….apng` |

The taste call is yours. Record it in a file named by `DEEPBUILD_TASTE_142` (the suite's README gives the form:
`{issue: 142, criterion: "#142.0815c532", verdict: "looks_right" | "looks_wrong", who, when, files: {name →
sha256}, note}`, every one of the 23 files named with its SHA-256), and run `ac12-taste.test.ts` with it. Until then
the test reads INCONCLUSIVE, never PASS.

The examples are drawn in the default look: a document names a look by an asset in its evidence store, which the
examples (envelope only, one recipe instance) don't carry, so dark_math's board shows the recipe's math face and grid
on the clean look's paper.
