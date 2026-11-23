# #62's planted wrong records

PR #652 made the learned layer a function of the log, and that work is on the merge base, so this
suite's `#62.190a469d` test passes there. The test is proven instead by two wrong programs whose
learned layer, as the appends build it, differs from the one a rebuild replays from the log. Each
twin is a file from the merge base with one change:

- `layer-reads-clock`: `packages/record/src/projections.ts`, where the `learned_layer` row takes
  `created` from the clock (`Date.now()`) instead of the event's own `ts`. The rebuild runs later
  than the appends, so the column differs.
- `refusal-kept-outside-the-log`: `packages/record/src/index.ts`, where a refusal the core read
  in the evidence store at append is written straight into `learned_layer` once the change commits,
  instead of being appended as `learn_check.made` in the change's commit. A rollback by rule still
  gets its event. The rebuild has no event for the refusal, so the change comes back applied.

Each fails the suite's comparison `expect` (`rebuild.test.ts:301`) at an assertion (run on this
Mac, Nov 22, 2026, seed 62190469):

- layer-reads-clock: `learned_layer: row id='01K74FKZQR0000000000000006' column created:
  incremental 1795405201330, rebuilt 1795405202091`, on property run 1.
- refusal-kept-outside-the-log: `learned_layer: row id='01K7998CYA0000000000000008' column state:
  incremental 'refused', rebuilt 'applied'`, on property run 2.

A third twin was tried and dropped because the suite passed on it: the rollback's read of
`learn_check.made` without its `log_pos < ?` bound. No generated `learn_check.made` names a
rollback at all: the core reads a rollback only when it is by rule, and refuses one only for the
replays it cites, and no generated rollback cites a replay. So that read never runs, and live and
rebuilt layers agree on it.

The suite's `tsconfig.json` includes `./**/*.ts`, so it also takes in these twins, whose relative
imports resolve only at their repo path. So `tsc --noEmit -p tests/acceptance/62-sweep-2047`
reports TS2307 for them, and the type errors that follow from it; it reports none outside
`twins/`. No lane runs that tsconfig, and the suite is the blind
job's, so this is left as it is.
