# Criterion 4 is proven by its redraft

Criterion `#405.17969a94` ("Budgets, on the reference Mac in the local preflight, compared with the merge base: the
geometry audit of a 1,000-part figure takes under 500 ms, and determinism hashing adds under 5% to render time") is
proven by `tests/acceptance/405-redraft-ac4/budgets.test.ts`, not by this folder's `budgets.test.ts`.

**The dispute:** this folder's file shows a rendered copy of the 1,000 parts with a `camera@1` and a `light.sun@1`,
and no `params.paint` on any part. At the base, a lit scene3d solid with no paint fill role is refused when the
document is shown (`ref_unresolved` at `items/plate/params/paint/fill/role`, "scene3d.lights can't evaluate this"),
and the design gives a 3D solid no default fill. The document never reaches the determinism check, so the file fails
at `presented` on any implementation.

**The redraft:** a blind job wrote it from the issue, the design, the base 903a1c07 and that dispute alone. Every
solid it shows names a paint fill role the look has. On the change it decides both rows and reports their times; off
a quiet reference Mac it reads INCONCLUSIVE, as the lane's rule says.

**The swap:** the owner approved it on Nov 10, 2026, in the session that built #405 ("Yes, swap it"). In
`scripts/lanes.mjs`, the original file moved to `byHand`, the redraft runs alone with its file timed, and this
folder's other three files are listed alone by name. None of this folder's test files was edited.
