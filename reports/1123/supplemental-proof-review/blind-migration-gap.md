# #1123 AC1 supplemental blind job — BLOCKED

**No executable acceptance test is proposed. No criterion is proven.** This is a
blocker analysis, not a saved proof record, an approval, or a replacement for any
existing acceptance test. Adding a tagged test that passes after finding an inner
failure would not meet this request.

## Requirement, held whole

`#1123.4ed9aa75`:

> The parallel block absorbs up to 29 folders, and every moved file's wrong program
> still fails in the parallel block before it leaves `alone`

Scope also requires **only sole-binary-rewrite folders** to move, the load/timing
exemptions to remain timed, and #236's shared sandbox log stream to remain alone.
Every moved original test must run unchanged; a file needing `DEEP_BIN_DIR`
adoption first needs its independently drafted, approved redraft. A genuine
compiled wrong source, source/build/run provenance, overlapping execution intervals, and a failing
**outer** tagged test on a relevant base or runnable registered wrong runner are
required. Neither exactly 29 nor a guessed migration list is acceptable.

Inputs read: issue `1123.json`; immutable base
`092754bb14a75cd07157e623e21b0d9e7a51677a`; its AGENTS, technical design (including
Dogfooding and proof rules), parallel-proof design, runner sources, and existing
acceptance tests/helpers/READMEs. No working implementation was inspected.

## What the named surfaces actually provide

Paths and line numbers below refer to that base, not to a proposed implementation.

1. **Plans are available; an eligibility reason is not.**
   `scripts/affected.mjs:270` exports `plan(cwd, tests, changed)`, separating
   parallel/alone, timed, slow and skipped files. `scripts/lanes.mjs` exports
   `alone`, `exclusive`, `timed`, `byHand`, and `checks`. Thus a future test can
   compare real plans from two isolated trees. It must include slow files in that
   comparison without executing timed/by-hand files. A deleted `alone` entry
   alone is not a move: another exclusion may still hold its files.

   These lists do not encode “sole reason is binary rewrite.” Some reasons are
   prose in lane comments or suite READMEs. Binary use by itself establishes no
   eligibility: a suite may also need a GPU, real windows, a fixed port or a load
   gate. The named 29/56 are bounds/context, not an enumerated eligibility map.
   This job cannot substitute a guessed list or assert that all cargo users move.

2. **The existing wrong-program registry is not a generic per-file recipe.**
   `scripts/proof-runs.mjs:458` reads `twins.json` as criterion tags to overlay
   folder names. It does not supply, for every file, a wrong source, build target,
   feature set, expected failing assertion, or executable provenance.

   Concrete examples, **not migration candidates**: base
   `tests/acceptance/1653/twins.json` names `isometric_as_square_grid` and
   `tiles_in_row_order`, but neither corresponding `twins/<name>/` directory
   exists. `isometric.test.ts` instead supplies `planted` request values and has
   tests that *pass* when those bad responses are observed. Its registration
   covers neither `halo.test.ts` nor `refusals.test.ts`. Likewise, the two names
   in `536/twins.json` have no overlay directories at this base. Such existing
   behavior tests can be reused, but their passing inner negative cases are not
   independently compiled wrong programs for all their files.

   The built-in mutation lane does not fill this gap: it targets added production
   lines, not arbitrary unchanged behavior reached by scheduling changes. Its
   cargo-mutants path explicitly attributes no kills to acceptance test IDs.
   Replacing a binary with an exit stub, changing tests, or accepting compilation,
   import or setup failures would fabricate the missing behavioral proof.

3. **Selection and focused execution are separate surfaces.**
   `affected.mjs --list` exposes a real selection without running it. Its command
   construction/execution is inside private `main`/`run` functions
   (`affected.mjs:337,373,399–400,420–424`). Running the CLI also runs the lint
   commands and reached cargo tests; it has no existing selected-parallel-only
   execution switch. Its path arguments describe changes, not an exact test list.

   A possible focused route is the exported `lanes.mjs` unit command and
   `runLanes`: retain the actual parallel command, exclusions and repository
   Vitest configuration, then narrow its file arguments. This is materially
   different from inventing `vitest run <files>` with a separate configuration.
   It still needs the per-file wrong-source recipes and observation below.
   `proof.mjs before/trace` is not that route: its `runVitest` explicitly supplies
   `--no-file-parallelism` (`proof-runs.mjs:374–381`). Running it on the moved
   files cannot itself establish parallel-block failure.

4. **Current result records do not supply the required causal trace.**
   `proof-vitest-reporter.mjs:33–46` records results/errors and an end marker,
   not per-file execution start/end intervals, worker identities, or consumed
   executable digests. The node proof reporter likewise omits timestamps.
   `lanes.mjs:899` records the source tree and test states, not the build-source
   to executed-binary chain. A `maxWorkers` value, parallel plan label, successful
   build, report existence, or overlapping parent-process lifetimes proves none
   of the missing facts.

   Test-only observation using runner callbacks and real compiler/process
   boundaries could supply additional facts without a product API. It must
   observe execution rather than queue events, preserve assertions and the
   selected configuration, and follow binaries copied by existing helpers
   (`467/helpers.ts`, `536/helpers.ts`, for example). No such observer was
   implemented or validated here; absence from today's reporters is not a claim
   that an observer is impossible.

5. **A final-tree run cannot establish historical “before removal.”**
   A replay can prove that a wrong source fails *now*. Neither `plan`, the lane
   record nor `twins.json` establishes that it failed before the scheduling edit.
   The current unit command excludes folders still in `alone`, so simply adding
   them as file arguments before removal does not test them in that command.
   Dropping exclusions in a test changes the command under examination. A live,
   ordered staging/gating procedure must bind the prospective scheduling tree,
   approved unchanged test bytes, wrong-source builds and observed failures before
   permitting the actual removal. A checked-in JSON saying this happened, a git
   timestamp or a report-exists assertion is not that procedure.

## Requirement → proposed proof → present status

| Obligation | Necessary check | Status here |
|---|---|---|
| Absorb up to 29 folders | Derive actual alone-to-parallel file transitions from both real plans; count distinct moved folders against 29; reconcile every file | Feasible runtime comparison, but unimplemented/unrun; not a reason to inspect a working branch during drafting |
| Only sole-binary-rewrite folders | Establish each derived folder's eligibility independently of its changed scheduling declaration | BLOCKED for a generic check: plans omit reasons; a blind per-folder review is still needed |
| Preserve timed/shared-stream exemptions | Compare real classification of all previously timed files and #236, including files that did not move | Unrun; no exemption waived |
| Redraft/approval gate | Reuse unchanged adopted tests only after their independent redraft and required approval; keep the scheduling change separately reviewable | Unrun; no adoption or approval inferred |
| Every moved file still catches its wrong program | Run each unchanged file's behavioral assertion against a successfully compiled relevant wrong source through the selected parallel command | BLOCKED: generic per-file wrong-source recipes are absent |
| Real concurrent execution and provenance | Observe per-file active intervals overlapping another selected file, and bind source → build → executable actually used → assertion | BLOCKED: existing reports are insufficient; no observer validated |
| Failure before removal | Enforce live proof before the scheduling change is admitted, not infer history from a later replay | BLOCKED: no such gate exposed by these surfaces |
| Outer tagged test is falsifiable | Run that same outer test on base or a registered executable wrong runner and observe its own relevant assertion fail | Unrun; no tag or pretend twin registration added |

## Execution and wrong-program plan

**There is no acceptance execution command for this deliverable:** it contains
only this README. In a separately provisioned disposable checkout, these existing
commands have precise but insufficient meanings:

```sh
node scripts/affected.mjs --list --slow scripts/lanes.mjs
# Real affected selection; no tests or parallel-execution evidence.

node scripts/proof.mjs before trace
# Real outer before/trace judging; not parallel execution of Vitest files.
```

Do not run the second command as part of this restricted drafting job: it can
install and build. No full unit/preflight run is requested as a workaround.

A future executable needs this order, with no new product flag or environment
option assumed:

1. Derive the migration from both plans over the original/adopted file inventory,
   fail closed on unexplained missing files, and establish eligibility, redraft
   approval and exemptions. Preserve uncertainty for an empty transition set: it is not proof
   of absorption, and no arbitrary minimum count is substituted for “up to 29.”
2. Reuse each file unchanged. Bind it to a blind-drafted source perturbation and
   the existing build invocation appropriate to that file. Build/run the correct
   source as the control; then compile the wrong source in isolation. Observe a
   specific behavioral assertion changing from pass to fail, not merely nonzero
   exit or a failure already present on the correct program. Every moved file
   needs its own attribution; a folder-level failure is insufficient.
3. Use the real selected parallel command/configuration and collect fresh causal
   observations. Prove overlap during actual file execution on both control and
   wrong runs. No synthetic replacement suite, owned-code mock or stale report.
4. For the outer test's wrong runner, a narrow candidate is a source overlay of
   the real `vitest.config.ts` adding `fileParallelism: false`, retaining its
   includes, setup and worker setting. Register it through the existing
   `twins.json` overlay mechanism only with an executable outer test. That test's
   concurrency assertion must itself fail even though individual original tests
   may still kill their wrong binaries serially. Also reject missing/unrun files
   and failures from unchanged binaries. This is a plan, **not a registered,
   compiled, executed or proven twin**.
5. Couple those live checks to the pre-removal staging step. A later replay may
   protect against regressions but cannot retroactively supply this step.

The missing pieces cannot be replaced by a passing generic test from the inputs
read here. They need explicit per-file blind wrong-source work and an authorized
live staging/observation arrangement. This does not approve any runner change or
change any acceptance criterion.

## Checks and delivery status

- Independently recomputed the criterion hash from the issue: `4ed9aa75`.
- Read-only inspection confirmed the example missing overlay directories above.
- Base archive has neither `.git` nor `node_modules`; no history or dependencies
  were imported from another checkout.
- No builds, installs, compiler invocations, test runs, GUI runs, commits or
  GitHub writes. No existing file was modified.
- No base-red, correct-green, per-file wrong-program-red, outer wrong-runner-red,
  source/time trace or Mac execution evidence exists from this job. All unrun.
- `node scripts/affected.mjs` was not run. This is a docs-only proposed addition;
  review is of this document and its source references. No WIDE or INCONCLUSIVE
  runner lines were produced. Overall acceptance status remains **BLOCKED**.

**Deviation:** the requested additive executable proof was not supplied, rather
than supplying one that silently drops chronology, eligibility, per-file proof,
real concurrency or outer-test falsifiability. No criterion is dropped. This job
cannot recommend `Closes #1123`.
