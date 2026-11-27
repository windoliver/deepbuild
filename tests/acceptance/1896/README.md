# Acceptance tests for #1896: a new check kind or work kind is one entry

Written first, blind, from issue #1896 as the brief quoted it, the design (Checks for work beyond code; How runs become
one of five verdicts; Dogfooding), AGENTS.md and base commit `d303e2b64` (= origin/main), by a job that never saw an
implementation; none existed, and no other branch, worktree, pull request or stash was read, nor the live issue. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#1896.6e954ac7` | `added-kind.test.ts` (1): a fifth work kind added to a copy of checks-work is offered by the hub |
| AC2 | `#1896.ab6a2c22` | `one-mapping.test.ts` (1): exactly one place in `packages/proof/src` maps from a runner's name, and a planted second switch makes two |
| AC3 | `#1896.6f3b1f79` | no new test (below) |

The IDs are the brief's; the live issue body wasn't read, so they aren't checked against it.

## The sites, confirmed at the base

The issue read them at 6a6d6b4f; at `d303e2b64` they are:

| File | Site | What it does |
|---|---|---|
| `packages/hub/src/kinds.ts:106` (the issue's `:74`) | `(['service', 'data', 'document', 'message'] as const).map(...)` | repeats checks-work's four kinds, each given the `definition` route |
| `packages/checks-work/src/index.ts:16-21` | `BUDGETS: Record<WorkKind, KindBudget>` | the owner's own list: `register` (`:35-37`) registers `Object.keys(BUDGETS)` |
| `packages/checks-work/src/types.ts:4` | `type WorkKind = 'service' \| 'data' \| 'document' \| 'message'` | the type; checks-work exports no list of kinds as a value |
| `packages/proof/src/check.ts:10`, `:11` | `spec.runner === 'lean4'`, `=== 'kani'` | the run; default: `missingRun`, naming the runner |
| `packages/proof/src/index.ts:47` | `spec.runner === 'kani' ? kaniMutants : leanMutants` | the mutants; default: Lean |
| `packages/proof/src/run.ts:100` | `spec.runner === 'lean4' ? {...} : {...}` | the key's tools; default: Kani |
| `packages/proof/src/kit.ts:43`, `:45`, `:47` | `runner === 'kani' ? ... : ...` three times | the kit's fixture folder, toolchain pin and locate; default: Lean |

So proof maps from a runner's name in four files, seven comparisons, with three defaults (the issue's "two different
defaults" are `index.ts`'s Lean and `run.ts`'s Kani; `check.ts` refuses).

## AC1: the mechanism

"A work kind added to checks-work in a test": the test copies `packages/checks-work/src` (tests left out) to a folder
under the OS temp dir, linked to the repo's `node_modules`, with a fifth kind `parcel` added, and stands the copy in
for `@deepbuild/checks-work` with `vi.doMock`. Nothing under `packages/` is written, and `packages/hub` is loaded as it
is, so `kinds.ts` gets no edit. The folder is removed after the test.

The kind is added by reading each source with the TypeScript parser, never by an export's name:

- an object literal whose keys include all four kinds gets `parcel: <message's value>` after `message`;
- a list whose elements stand for all four kinds (the name; a tuple that starts with the name; a record with a field
  that holds the name) gets message's element again with `'message'` → `'parcel'`.

At the base that changes `index.ts:20` (`BUDGETS`) and `kit.ts:97` (the kit's `FIXED` fixtures).

Then one assertion on a summary:

- `addedToChecksWorkAlone`: the copy changed in at least one place (the message names them);
- `checksWorkRegisters`: the changed checks-work's own plug-in (its default export, `register`) registers
  `data, document, message, parcel, service`: the owner holds the fifth kind;
- `workKindsTheHubLacks: []`: every kind checks-work registers is in `openKinds(...).list()`, the table `checks.kinds`
  answers from (`kinds.ts`: "`checks.kinds` reads it back");
- `parcelIsRouted: 'as message is'`: its routes are message's (the `definition` route);
- `aDefinitionMayNameParcel`: `definitionSpec` takes a drafted check of kind `parcel`, as the gate reads one.

Checked on the base that the hub loads the stand-in: a throwaway variant whose copy named its fills `<kind>-copy` made
the hub offer `service-copy, data-copy, document-copy, message-copy`. The variant was deleted.

### What the implementation must meet

1. The hub reaches checks-work's kinds through the package's entry, `@deepbuild/checks-work` (AGENTS.md: a module is
   reached only through its public entry), statically or dynamically. A deep import of one of its files isn't stood in
   for.
2. checks-work's kinds stay written in its sources in a shape the two rules above find: an object literal keyed by
   every kind, or a list of every kind. Whatever the hub reads (a list, the fills, a function) must be derived from
   that, with nothing else to edit to add a kind's budget, so that `parcel` gets a budget and is admitted.
3. checks-work's default export keeps registering every kind it holds.
4. The hub's module `packages/hub/src/kinds.ts` keeps exporting `openKinds`, whose `list()` and `definitionSpec()` read
   the table without the options (the test hands it `host`, `extensions` and `plant` only).
5. A work kind's route stays one rule for all of them, so `parcel` is routed as `message` is.

Running `parcel` is not asked for: the copy gives it message's budget and no runner of its own.

## AC2: the pattern

The test parses each non-test `.ts` file under `packages/proof/src` with the TypeScript parser and counts these
places, the runners' names being `lean4` and `kani` (`types.ts`, `ProofRunner`):

| Place | Counted as |
|---|---|
| `a === b`, `!==`, `==`, `!=` where either side is the string `'lean4'` or `'kani'` (through `as`, `!`, parentheses) | one per comparison: an `if`, a ternary, a filter |
| `switch (x)` where `x` is `runner`, `<any>.runner` or `<any>['runner']`, or any case is a runner's name | one per switch, whatever its cases |
| an object literal whose keys (plain, quoted or computed strings) include both `lean4` and `kani` | one table |
| a list of tuples whose first elements include both names, as `new Map([['lean4', …], ['kani', …]])` | one table |

Expected: exactly one, so the one mapping is one table or one switch; an `if` chain over both runners counts two.
Not counted: the type `'lean4' | 'kani'`; a runner's name passed as an argument or kept as a value (`kani('…')`,
`['lean4' as const]` in `toolchains`); a look-up in the table (`TABLE[spec.runner]`), however many; an object with one
runner's key (`{ lean4: version, … }`, the key's tools); `cargo(['kani', …])`. Not found: a mapping written without the
names (`runner.startsWith('k')`), or with a name built at run time.

The kit counts: `kit.ts`'s fixture folder, pin and locate per runner must come from the one table, or be handed to its
`spec` helper by the `kani`/`lean` helpers, which map from nothing.

"A planted second switch fails a test that reads the sources": the same test reads a seven-line planted
`switch (spec.runner)` as one more source of the package and expects the count with it to be two. A twin can't say
it: a twin is wrong lines applied to a file as the change holds it (#1832), and that file isn't known here.

## AC3

"The suites that cover the touched files pass unchanged against the merge base, and each package's type-check passes" is
proven by running those suites (`packages/hub`, `packages/checks-work` and `packages/proof` tests, and the acceptance
suites that read `kinds.ts` and proof: grep `tests/acceptance` for `openKinds`, `checks.kinds` and `@deepbuild/proof`)
with no edit to them, and `tsc` for each touched package, not by a test here; a test restating it would prove
nothing, and it can't fail on the merge base.

## Twins

None, so no `twins.json`: both tests fail on the merge base at their assertions, which is their wrong program, and a
twin's lines can't be written against files whose final shape isn't known.

## Run them

```sh
npm ci && npm run build --workspaces   # vitest.config.ts needs the packages' dist
node node_modules/vitest/vitest.mjs run tests/acceptance/1896 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/1896/tsconfig.json
```

A few seconds; 30 s per test, so a hang fails. No binary, no network; one temp folder, removed. No `lane.json`: the
suite shares nothing.

## Base results

`BASE-FAILURE.txt` is the run at the base, whole, with the checkout's path replaced by `<repo>`, on macOS arm64 at load
~35: 2 failed, 0 passed, each at its summary assertion. The suite's `tsc` exits 0.

| Test | Base answer |
|---|---|
| AC1 | checks-work registers `parcel`; the hub offers `command, review, numbers, service, data, document, message`; `workKindsTheHubLacks: ['parcel']`, `parcelIsRouted: 'not offered'`, `aDefinitionMayNameParcel: false` |
| AC2 | 7 places (8 with the planted switch): `check.ts:10`, `:11`, `index.ts:47`, `kit.ts:43`, `:45`, `:47`, `run.ts:100`, all comparisons |

No fix was tried against the suite.
