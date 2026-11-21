# Acceptance tests for #1907: checks-journey computes only what something reads

Written first, blind, from issue #1907 as the brief quoted it, the design (Checks for work beyond code; Dogfooding),
AGENTS.md and base commit `ee05e7257` (= origin/main), by a job that never saw an implementation; none existed, and no
other branch, worktree, pull request or stash was read, nor the live issue. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Nothing here was run: the
clone had no `node_modules`.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#1907.0d8e070f` | `result.test.ts` (1): four journeys, this checkout's package against the merge base's |
| AC2 | `#1907.ee5abddf` | `reads.test.ts` (1, plus 1 untagged check of the reading itself) |
| AC3 | `#1907.6f3b1f79` | no test: proven by a run (below) |

The IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text after `- [ ] `, recomputed here.

## What the base holds (confirmed at `ee05e7257`)

- `src/run.ts` `drive()` returns a `DriverRun { report, dir, out, artifacts, exit, wallMs, settled }`; each artifact is
  `{ name, path, sha256, size, kind }`, hashed at lines 150-159. Its only reader is `src/index.ts` (`run.ts` is not
  exported from the package entry, and no other package, `tests/acceptance/37` or `benchmarks/journeys.mjs` imports it):
  it reads `report`, `artifacts[].name` and `.path`, every field of `exit`, `settled`, and `dir` through
  `discard(driven)`. Nothing reads `out`, `wallMs`, or an artifact's `sha256`, `size` or `kind`; evidence is hashed by
  the evidence store on `put`, which is the hash the record cites.
- `DriveOptions` has `host`, `run`, `dir`, `secrets` and `stop` read only by `drive`'s `o.pre ?? prestart(...)`
  fallback; index.ts always passes `pre`, and never `dir`. These are options, not result fields, so no test here names
  them: a test can't tell an unused option from a used one through the result, and AC3's suites and type-check are
  what show a removal broke nothing.
- `runtime/driver.mjs` branches for steps `journey.ts` can't emit: likewise not reached by a test here (they are
  unreachable by definition); AC1's comparison and AC3's suites show their removal changed nothing.

## Readings

- **"The result type"** (AC2) is the type of what one driver run hands back: the awaited return type of `drive` in
  `packages/checks-journey/src/run.ts` (`DriverRun` at the base), with every object type `run.ts` declares for its
  fields, nested (the artifact, the exit record, the report's types). It is the type the issue's "unread hashes" live
  in. The report's own types are the driver's JSON, parsed and never written by the TypeScript, so none of their
  fields counts as written. `JourneyRun`, the package's public result, is not "the result type" here: its readers are
  the hub-to-be and every suite, and the issue names no unread field of it. (Seen in passing, not tested: `api.ts`'s
  `ApiRun.run` and `steps[].status` look written and never read by `index.ts`; the issue doesn't name them.)
- **"Written"** and **"read"**: as `reads.test.ts`'s header says, found with TypeScript's checker by declaration, never
  by name. Reads are counted in the package's `src/` only, where every reader of the unexported type lives; a test
  reading a field doesn't keep it.
- **"The package's result"** (AC1) is `runJourney`'s `JourneyRun`, what the public entry hands back for a journey
  (check.kind@1's `CheckResult` plus the run record): the result anything outside the package sees.
- **"The recorded journeys in its suites"** are the journey files the package's suites run, the sample app's
  `tests/acceptance/37/fixtures/app/.deepbuild/journeys/`: `cart-total`, `cart-api`, `login` (given a random
  `TEST_PASSWORD`, the same on both sides) and `motion`. `checkout` is left out: its order ID is random on every run by
  design, so no two runs of any program agree on its route or readback.
- **"Byte for byte the merge base's"**: both results serialized as JSON text and compared as strings, after the same
  replacements on both sides for what no two runs share: `startMs`/`endMs` and `timing` set to 0, the stack's pid and
  ports set to 0, the run handle, the stack's run handle and the checkout's path replaced by placeholders, any
  `127.0.0.1:<port>`, and each SHA-256 replaced by its order of first appearance in that run (so which fields cite the
  same evidence still compares, while bytes the browser makes anew each run, the video and the trace, don't).
- **"Less the deleted fields"**: from the base's result, every key this checkout's result lacks at the same place is
  removed before comparing; nothing may be added or changed.
- **"The merge base"**: `git merge-base HEAD origin/main`, its `packages/checks-journey` exported with `git archive` to
  `target/acceptance-1907-base/<sha>-<pid>/` (removed after the file) and imported from there, so it runs its own
  `run.ts` and its own `runtime/driver.mjs` against the same dependencies, app and Chromium. No merge base is BLOCKED.

The base's run of a journey must pass to be a reference; one that doesn't is BLOCKED (thrown, not asserted), so a
machine where Chromium can't launch never passes or fails AC1. One test compares all four journeys, so its one
assertion shows every difference at once.

## AC3

"The suites that cover the touched files pass unchanged against the merge base, and each package's type-check passes"
is proven by running those suites (`packages/checks-journey/test/` and `tests/acceptance/37/`, the files that import the
touched package) and `tsc` for each touched package, not by a test here; a test restating it would prove nothing.

## Wrong programs

`reads.test.ts` fails on the merge base at its assertion, naming `DriverRun.artifacts.kind`, `.sha256`, `.size`,
`DriverRun.out` and `DriverRun.wallMs`. `result.test.ts` passes there (the base against itself), so it has a twin,
`keeps-no-video` (`twins/README.md`).

## Run them

```sh
npm ci && npm run build --workspaces   # vitest.config.ts needs the packages' dist; Chromium as tests/acceptance/37/README.md sets it up
node node_modules/vitest/vitest.mjs run tests/acceptance/1907
node node_modules/typescript/bin/tsc -p tests/acceptance/1907/tsconfig.json
```

`result.test.ts` runs eight journeys (four per side), each with its own stack on 127.0.0.1 and its own Chromium, under
the 37 suite's helpers (folders under `/tmp/dh37-*`, processes stopped by PID): a minute or two. It needs git and
`origin/main` in the checkout it runs in. `reads.test.ts` builds one TypeScript program of the package: seconds.
