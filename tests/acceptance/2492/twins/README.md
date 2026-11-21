# #2492's planted wrong hosts

PR #2493 fixed the faults in `packages/extension-host/test/environment-runtime.test.ts` and
`environment-timeout.test.ts`. That fix is on the merge base, so this suite's tests pass there.
Each test is proven instead by a wrong host that skips the cleanup a file covers. Each twin is
`packages/extension-host/src/host.ts` from the merge base with one change:

- `late-handle-left-running`: when a start overran its deadline, the start doesn't stop the
  handle it returns late (the `await down()` in `RuntimeEnvironment.up`'s cancelled branch is
  gone). That handle stays in its load's stop list and keeps running, even though the timeout
  already unloaded that load. `environment-timeout.test.ts` fails at its wait for the late
  handle's own stop, so the suite's `#2492.406745f0` test and its timeout `#2492.eac47520` test
  fail at their assertions.
- `active-handle-left-running`: unloading a provider, as `disable` does, stops none of its
  active environment handles (`stopHandlers` calls no `down`). `environment-runtime.test.ts`
  fails at its check that disable stopped the active handle, so the suite's `#2492.406745f0`
  test and its runtime `#2492.eac47520` test fail at their assertions.

The suite turns any inner failure into an outer `AssertionError`, so the inner failure each twin
causes was read from the outer message (run on this Mac, Nov 20, 2026):

- late-handle-left-running: `expected [] to deeply equal [ { id: 'env-…', … } ]`, from the
  `expect.poll(...).toEqual` on the late handle's stop in `environment-timeout.test.ts`
  ("Matcher did not succeed in time"); the runtime file passes.
- active-handle-left-running: `expected [] to deeply equal [ { id: 'env-…', … } ]`, from
  `expect(stopped).toEqual([running.handle])` in `environment-runtime.test.ts`; the timeout
  file passes.

The suite's `tsconfig.json` includes `./**/*.ts`, so it also takes in these twins, whose
relative imports resolve only at their repo path. So `tsc -p tests/acceptance/2492` reports
TS2307 for them. No lane runs that tsconfig, and the suite file is the blind job's, so this is
left as it is.
