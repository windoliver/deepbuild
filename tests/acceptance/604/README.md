# Acceptance tests for #604: hook kinds are written only by the hook, readings only by the core

Written first, blind, from issue #604 (its text as of October 20), `docs/technical-design.md` (the `events`
table's `writer` column, the adapters' mapping of hook payloads, `deep.registerSource`, the extension API
table's Event row and the list of kinds only the core appends) and base commit `f346706`, by a job that
never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job.

Run them (a root with no config of its own uses Vitest's defaults; the repo's `vitest.config.ts` also takes
`tests/**/*.test.ts` from `scripts/lanes.mjs`, so `npx vitest run tests/acceptance/604` and the unit lane run
them too):

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/604
```

`writers.test.ts` runs `cargo build --locked -q -p deep-contracts --bin deep-contracts` in the checkout first
(a minute or two the first time). The tests import `packages/contracts/src/index.ts` with its `.ts`
extension, as `tests/acceptance/311` does.

## Criteria to tests

| ID | Criterion | Tests |
|---|---|---|
| AC1 | Each of the seven kinds' first fixture validates with the writer named, and is refused with each other writer form, in TypeScript and through the Rust types | `writers.test.ts` |
| AC2 | `tests/acceptance/311` passes unchanged | not duplicated here: run `npx vitest run --root tests/acceptance/311` on the fix, with those files unchanged from the base |
| AC3 | The seven digests are refrozen and no other digest changes | `digests.test.ts` |

The seven kinds and their writer: `tool.before@1`, `tool.after@1`, `agent.stop@1`, `session.start@1` and
`user.ask@1` take `hook`; `reading.recorded@1` and `reading.batch@1` take `core`.

## The surfaces used

Only what the issue and the existing contract tests name; nothing new is asked of the package.

- `validate(name, value)` from `packages/contracts/src/index.ts`, its `Validation` result and each issue's
  `path`. A refusal must name `/writer`.
- `fixtures(name)[0]`, the kind's first fixture as shipped in `packages/contracts/fixtures/<kind>@1/`, with
  `writer` replaced. The fixture's other fields are left as the fix ships them.
- `deep-contracts check <schema>` (the binary in `crates/deep-contracts`), one JSON document per stdin
  line, `ok` or `refused <reason>` per line, as `packages/contracts/test/rust-checks.test.ts` drives it. The
  tests read only `ok` and the `refused` prefix, not the reason's wording.
- `d1Digest`, `getSchema`, `listSchemas`, `frozenDigests` and `sha256Hex` from the package's public entry,
  and `packages/contracts/digests.json` read as a file.
- `fixtures/base-digests.json`: `git show f346706:packages/contracts/digests.json`, byte for byte. The test
  pins its SHA-256 (`81ab2794…0fce`), so the copy can't drift from the base.

## Readings where the issue leaves a choice

- **The writer forms.** "Each other writer form" is read as one instance of each form the design names
  (`hook`, `app`, `cli`, `mcp:<session>`, `ext:<id>`) plus `core`: `app`, `cli`, `mcp:x`, `ext:x`, and `core`
  for the hook kinds or `hook` for the readings. `mcp:x` is already refused on the base; it stays in so a
  pattern widened the wrong way fails.
- **"Refrozen"** is read as: the entry differs from the base's and equals `d1Digest` of the schema as it now
  is. A narrowed pattern reshapes the schema (the issue says so), so a refrozen entry can't keep the base
  value.
- **"No other digest changes"** is read as: every entry `digests.json` had at the base is the same string now, and
  that schema's `d1Digest` is still that string, so no other schema was reshaped either; a base name missing from the
  file counts as changed. A name added since the base is not a change and is allowed: the criterion says nothing may
  change, not that nothing may be added. `frozenDigests()` must equal the file, entry for entry.
- **The package fixtures.** The base's first fixtures of `session.start@1`, `user.ask@1`, `reading.recorded@1`
  and `reading.batch@1` carry writer `app`, which the narrowed schemas refuse. These tests set the writer
  themselves, so they don't care; `tests/acceptance/311` (AC2) and the package's contract tests validate
  every fixture as shipped, so the fix has to change those four fixtures' writer to `hook` or `core`. The
  issue doesn't say so; it follows from AC2.

## Files

- `writers.test.ts`: AC1, TypeScript and Rust, one test per kind for each.
- `digests.test.ts`: AC3.
- `helpers.ts`: the seven kinds and their writers, the writer forms, the first-fixture copy, the cargo and
  `deep-contracts check` drivers.
- `fixtures/base-digests.json`: the base's `digests.json`.
- `BASE-FAILURE.txt`: the run on the base, where 21 tests fail, each for the expected reason, and the
  planted wrong programs each test was run against.
