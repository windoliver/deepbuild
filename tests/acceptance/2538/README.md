# Acceptance tests for #2538: doctor.item@1 lists every code deep doctor emits

Written first, blind, from the live issue #2538, the design and base commit `aac4d9769` (#2146's branch, which this
issue builds on), by a job that never saw a fix; no other branch, worktree or pull request was read. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2538.d5c537a3` | `codes.test.ts` (4): the schema file's `code` enum lists the three codes; `judge('doctor', code)` reads each as listed, verdict FAIL |
| AC2 | `#2538.982ff19a` | `lint.test.ts` (5): the real `node scripts/conformance-lint.mjs` prints PASS for code mappings and every kit with the three codes in the schema; each code's planted entry carries a fix text of its own; `doctor.item@1`'s entry in `digests.json` is the digest of the schema that lists them |
| AC3 | `#2538.8e3e2618` | `doctor.test.ts` (1, Linux only): every item `doctor --json` prints under an empty HOME carries a listed code |
| AC4 | `#2538.aaf41340` | `build.test.ts` (5): the hub's source type-checks clean; a twin with three builders given made-up codes fails `tsc`, each error in its file naming its code |

IDs are the first eight hex digits of the SHA-256 of each criterion's text, as `scripts/proof-change.mjs` computes
them. Run: `npx vitest run tests/acceptance/2538` after `npm run build --workspaces` (the lint and the CLI read
`dist`). `BASE-FAILURE.txt` holds the run on the base.

## Readings where the issue leaves a choice

- **"Still passes" (AC2).** At the base the lint already passes; the criterion is that it passes *with the three
  codes listed*. So the lint test's last assertion is that the schema file lists them, and it is the only one that
  fails at the base. The digest test likewise demands the three codes in the published schema before it compares
  the digest: at the base the entry already is its schema's digest (#2146), of a schema without them.
- **The lint on a machine whose ports can't be read (AC2).** Read as `tests/acceptance/2146/README.md` reads it: FAIL
  lines of the one `slot kit environment@1 … (lsof failed)` shape are allowed, with exit 1, and no other.
- **"A planted fix text" (AC2).** The kit's planted entry for the code (`kits()`, the conformance package's entry)
  has a `fix` that is not what `planted.ts` writes for a code it has no text for (`Resolve the <code> item.`, and
  `See deep doctor.` inside the entry). The lint itself doesn't fail on a missing text, so the lint alone can't show it.
- **Verdict FAIL for a warn-level item (AC1).** `mod_overrides_guard` is emitted at level warn; the criterion says
  FAIL for each, and the test asks for FAIL.
- **Where doctor runs (AC3).** In the checkout, as the issue's reproduction does, with only HOME replaced. The test
  also demands a `hub.polkit` item, so the run reached Linux's item. On a machine whose polkit knows
  `dev.deepbuild.confirm` that item reads healthy and this test passes at the base: there AC3 is proven only together
  with AC1 and AC4. Off Linux the suite is skipped by name (`describe.skipIf`), which vitest reports as skipped,
  never as passed.
- **"A doctor item builder" (AC4).** One of each shape the issue lists: an `add(...)` call (`doctor.ts`,
  `mcp_unregistered`), an `item(...)` call (`canvas-doctor.ts`, `gpu_unsupported`) and `relationItems`' object
  literal (`setup.ts`, `timing_relation_broken`). The twin replaces that quoted literal throughout the file with a
  made-up code; a fix that no longer writes the literal in that file makes the plant a setup error, which is a
  redraft's to settle, never a pass. Builders outside `packages/hub/src` (otlp, adapters) are outside the criterion.
- **"The hub's build fails" (AC4).** Type-checked with the repo's `tsc -p <project> --noEmit`: the same program and
  project file, nothing written. An error must be on a `error TS` line in the planted file that names the code.

## The twin (AC4)

No file is kept: `helpers.ts` (`hubTwin`) builds it per run in a temp folder laid out as the repo is (the root's and
the hub's `tsconfig.json` and `package.json`, `packages/hub/src` copied whole, `node_modules` a link to the repo's)
and removes it after. At the base it type-checks clean, which shows the overlay resolves as the real project does;
the test also refuses any error outside the three planted files.

## Not repeated here

`tests/acceptance/2146` (the lint's exit, an unmapped code named, every schema's digest), `tests/acceptance/313`
(every listed code judges to a verdict) and `tests/acceptance/311` (a reshaped schema drifts) already cover those.

## Open to the implementer, not tested

"The lint should compare the enum with what the hub emits" is in the issue's text, not in a criterion; AC4's
type-check is the criterion that closes the gap.
