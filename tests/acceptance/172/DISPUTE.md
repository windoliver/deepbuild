# Dispute: criterion 2's refusal test (`refusals.test.ts`, second test)

The first draft's capture piece, a figure whose control `wave` reads `hands@1`, declares the control without a `role`. The base's
document check refuses that document before it is presented (`document.validate`: `out_of_range` at `controls/wave/role`,
"required, and absent"), so no export of it is ever made and no export can refuse it by name; the test then fails on any
program, right or wrong. Shown at the base with `deep-show run`: the `deep show` reply is `refused` with that issue.

The test went to a fresh run of the blind job with the same inputs and the criterion (never the work, the diff or this
dispute), given the base fact that every control needs a `role`. Its redraft, `tests/acceptance/172-redraft-ac2/`, runs in
this test's place (`scripts/lanes.mjs`), and this file moves to the by-hand list. The first test here, the secret and the
hub's socket path in no bundle file, is not disputed and passes.
