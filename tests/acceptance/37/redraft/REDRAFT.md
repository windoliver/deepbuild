# Blind redraft of AC18 (`#37.66b03932`) of issue #37

Written on November 3, 2026, at the base commit `69803b94` (origin/main), by a job that never saw an implementation
of #37, the diff, the first job's `assertions.test.ts` or the dispute (design: Dogfooding). It replaces that one test;
`assertions.test.ts` here is the whole of it.

## What this job read

- Issue #37 (`gh api repos/windoliver/deepbuild/issues/37`): its body in full, and AC18's text, whose ID
  `#37.66b03932` is the first 8 hex of the SHA-256 of that text trimmed, whitespace collapsed and `- [ ] ` dropped,
  as `scripts/proof-change.mjs` computes it (checked with `sha256sum`).
- `AGENTS.md`.
- `docs/technical-design.md`: How runs become one of five verdicts (the verdict table, Fail before pass after,
  Failing on an assertion, Check health, Proof depth); the `journeys` row of First-party extensions that ship on by
  default; Dogfooding and Tests written first.
- The first job's suite at `tests/acceptance/37/`: `README.md` in full (How to run, the SURFACE block, the journey
  file shape, the sample app, Readings, the criteria table, Wrong programs, Files), `helpers.ts`, `wrong.ts`'s role
  from the README, `fixtures/app/server.mjs`, `fixtures/app/.deepbuild/done.yaml`, every
  `fixtures/app/.deepbuild/journeys/*.yaml` and `features/*.yaml`, `tsconfig.json`, and `endings.test.ts`,
  `errors.test.ts` and AC4 of `evidence.test.ts` for the conventions (a `describe` carrying the criterion's ID, test
  names starting with the criterion's number, a `(wrong program)` test fed through `assertionFails`, `journeyVariant`
  from `cart-total`, `storedPng` for a screenshot). `BASE-FAILURE.txt` was listed by the suite's run on the base; its
  listing shows the first draft's test names and nothing of its body. Not `assertions.test.ts`.
- `packages/conformance/src/slot-types.ts` for `Failure` (`test`, `file`, `line`, `assertion`, `message`) and
  `CheckResult`, which the README's `JourneyRun` extends; `scripts/proof-change.mjs` for how a criterion ID is carried.

## Readings

- **At its line.** `helpers.ts`'s `journeyVariant` writes the journey with the `yaml` package's `stringify`, which
  lays a step's `expect` and `click` out in block style, the key on its own line and its map on the lines under it
  (checked: `expect:` at line 11 with `role`, `name`, `visible` at 12 to 14; `click:` at 18 with 19 to 20; the toPass
  `expect:` at 23 with 24 to 26, in the Export journey the test writes). So the test reads the written file and takes
  "its line" as the span from the step's `expect:` or `click:` key line to the last line indented under it, as a
  Playwright call that spans lines is at any of them. The step's `id:`, `deadline:` and `timeout:` lines are not the
  statement. The three failures: the expect's is the `expect:` block of step `export-shown`; the click's is the
  `click:` block of step `export`; the toPass block's is the `expect:` block of step `until-exported`, whose expect
  carries `until: true`.
- **The file.** A failure's `file` is the journey file: relative to the checkout as the README reads it, or its path
  under the checkout.
- **The base build.** The sample app's working build (`checkout()` with no flag) has no Export button
  (`server.mjs`: the `export` flag adds it), so it is the base build the criterion names.
- **By its locator timeout, before the deadline.** The expect's `timeout` is 2000 ms and its step's `deadline`
  5000 ms. The step's `endMs - startMs` is under the deadline, and at least half the expect timeout, since an expect
  that fails by a locator timeout waited for it; the run is `failed` and the step `failed`, never `overran`, and the
  click step after it is `unrun`. The failure has `assertion: true`, says it timed out, and carries the selector:
  the role `button` and the name `Export`, as Playwright writes `getByRole('button', { name: 'Export' })`. The
  screenshot is the step's, stored by hash and in the run's `evidence`.
- **The click without the expect.** The same journey with the expect step left out: the run and the `export` step
  are `failed`, the failure at the click's line has `assertion: false`, says it timed out and names the button, and
  no failure of the run is an assertion failure.
- **The toPass block.** `expect: { until: true, evaluate: "window.exported.count", equals: "1" }`: every attempt
  throws a `TypeError` reading a property of `undefined`, so its last attempt's failure is one. The failure at the
  block's line has `assertion: false` and names `TypeError`; no failure of the run is an assertion failure.
- **The wrong program.** `plant: 'deadline-under-expect'` on the Export journey: the run is `overran`, step
  `export-shown` is `overran` and a failure names it; the criterion's assertion, run on that record, fails naming
  the step (`assertionFails`).

## Type check

With the first job's suite copied to `tests/acceptance/37/` (less its `assertions.test.ts`), a type stub of the
README's SURFACE block written at `packages/checks-journey/src/index.ts` (functions declared, no bodies), and
`node node_modules/typescript/bin/tsc -p tests/acceptance/37/tsconfig.json`: exit 0, no error. The stub was removed
afterwards. `vitest list` collects the four tests. Nothing was run against an implementation: none exists at this base.
