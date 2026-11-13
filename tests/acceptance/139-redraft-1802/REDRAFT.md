# #139 criteria `#139.607ef4f7` and `#139.b9c5c209` blind redraft, after #1802: a preview entry a test publishes carries `preview_since` and `decide_by`

#139 made every contract entry `stability: stable | preview`. Its criteria `#139.607ef4f7` and `#139.b9c5c209` say what
a preview entry may do: it is outside the break diff, a method no shipped piece calls may be published as one, and it
names a tracking issue. `tests/acceptance/139/preview.test.ts` tests them on preview entries published with a tracking
issue and nothing else. #1802 ends a preview. Its first criterion: "A preview entry with no `decide_by`, or one more
than 3 releases after its `preview_since`, fails the preflight, naming the entry". The design, in Contracts that can't
drift: "Every preview entry records `preview_since` and `decide_by`, both releases, with `decide_by` at most 3 releases
after `preview_since`, and the preflight fails one that lacks either or sets it later, naming the entry." A correct
contract step then fails every preview entry the frozen file publishes for the step's `check`, naming it. Three tests
expect such an entry to pass, and a fourth is the planted twin of one of them. The redraft keeps each scene, assertion
and failure message, and gives each preview entry the two fields.

Written from issue #139 (closed; read live with `gh issue view 139`, `updatedAt` 2026-10-31T01:41:58Z: its Scope and 17
criteria, of which the third is `#139.607ef4f7` and the sixteenth `#139.b9c5c209`, the frozen suite's "AC13" from when
the issue had 14), issue #1802 (open; read live, `updatedAt` 2026-11-12T18:26:12Z: its Scope, ten criteria and Proof),
the frozen `tests/acceptance/139/` (README.md, helpers.ts, preview.test.ts, REDRAFT.md, BASE-FAILURE.txt; its other
nine test files are not on this job's reading list and were not read), #1802's own blind suite `tests/acceptance/1802/`
(README.md, helpers.ts, BASE-FAILURE.txt, twins.json, tsconfig.json and the test files `ac1-…`, `ac2-…`, `ac3-…` and
`ac5-…`; tests, not an implementation), the design (`docs/technical-design.md`: Socket roles and contract versions, the
bullet Contracts that can't drift, which ends with the sentences from "A preview ends."; How we know version 0 works:
Frozen contracts, Wrong programs, Dogfooding, Tests written first; the Decisions row Contract history), `AGENTS.md`,
`tests/acceptance/306-redraft-1958/` for form (its five files), and base `eee08d40a` (origin/main `1c4d1f0e2`, plus the
docs-only commit `50cf3043c` that appends #1802's rule to the design, plus #1802's blind suite), read only for how the
surfaces are driven: `scripts/contract-diff.mjs`, and `packages/contracts/` for the published data a scratch tree
copies (which entries are preview, which fields each carries, and the commit one of them and the step each arrived
in). One slip: the first 600 bytes of `scripts/known-failures.json` were printed, which is outside that list; they held
three entries, none about contracts, and nothing here comes from them. I never read an implementation of #1802, any
diff, branch, pull request or other worktree.

## What #1802 changes, test by test

| Original (path › describe title › it title) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `tests/acceptance/139/preview.test.ts` › #139.607ef4f7 a preview method reshaped passes the diff; a stable package that calls it is refused at install; the same method stable fails; a stable method no shipped piece calls fails › AC3 a preview method reshaped between two releases passes the contract diff with no break file | `#139.607ef4f7` | It publishes deep.preview as a preview with a tracking issue and neither field, records R1, reshapes it and expects `check --release R2` to pass: exit 0, a PASS line, no FAIL line. #1802: a preview entry with no `decide_by` "fails the preflight, naming the entry". A correct step exits 1 naming deep.preview, and the scenario then throws "a contract step that diffs preview entries failed the reshaped preview method deep.preview", blaming the diff for a failure the diff didn't make | `tests/acceptance/139-redraft-1802/preview.test.ts` › #139.607ef4f7 a preview method reshaped passes the diff; a stable package that calls it is refused at install; the same method stable fails; a stable method no shipped piece calls fails › #139.607ef4f7 AC3 a preview method reshaped between two releases passes the contract diff with no break file (redraft 1802) |
| `tests/acceptance/139/preview.test.ts` › #139.607ef4f7 a preview method reshaped passes the diff; a stable package that calls it is refused at install; the same method stable fails; a stable method no shipped piece calls fails › AC3 (wrong program) a contract step that diffs preview entries asks for a break file, and this test fails it | `#139.607ef4f7` | The planted twin of the test above: the same scene on the step that diffs preview entries, which must fail where the right step passes. It expects the scenario to throw, and the scenario throws on any exit but 0. With the entry undated the right step exits 1 too, so the test passes on the right step and the planted one alike, and no longer tells them apart | `tests/acceptance/139-redraft-1802/preview.test.ts` › #139.607ef4f7 a preview method reshaped passes the diff; a stable package that calls it is refused at install; the same method stable fails; a stable method no shipped piece calls fails › #139.607ef4f7 AC3 (wrong program) a contract step that diffs preview entries asks for a break file, and this test fails it (redraft 1802) |
| `tests/acceptance/139/preview.test.ts` › #139.607ef4f7 a preview method reshaped passes the diff; a stable package that calls it is refused at install; the same method stable fails; a stable method no shipped piece calls fails › AC3 a stable method that no shipped piece of its release calls fails the preflight, naming it; called by a shipped piece, or published as preview, it passes | `#139.607ef4f7` | Its first two halves hold: a stable deep.orphan no shipped piece calls fails, and called by one it passes. Its third publishes deep.orphan as a preview with a tracking issue and neither field, and expects `check --release R2` to pass. A correct step fails it, naming deep.orphan | `tests/acceptance/139-redraft-1802/preview.test.ts` › #139.607ef4f7 a preview method reshaped passes the diff; a stable package that calls it is refused at install; the same method stable fails; a stable method no shipped piece calls fails › #139.607ef4f7 AC3 a stable method that no shipped piece of its release calls fails the preflight, naming it; called by a shipped piece, or published as preview, it passes (redraft 1802) |
| `tests/acceptance/139/preview.test.ts` › #139.b9c5c209 a preview entry names its tracking issue, and is used only by name: a package or a document lists it in requires.preview, or it is refused with preview_unrequested › AC13 a preview entry with no tracking issue fails the preflight, naming it; with one it passes | `#139.b9c5c209` | Its passing side publishes deep.untracked as a preview with its tracking issue and neither field, and expects `check --release R2` to pass. A correct step fails it, naming deep.untracked. Its failing side still fails, but on an entry that is then wrong twice (no tracking issue, no `decide_by`), so the two sides no longer differ in the tracking issue alone | `tests/acceptance/139-redraft-1802/preview.test.ts` › #139.b9c5c209 a preview entry names its tracking issue, and is used only by name: a package or a document lists it in requires.preview, or it is refused with preview_unrequested › #139.b9c5c209 AC13 a preview entry with no tracking issue fails the preflight, naming it; with one it passes (redraft 1802) |

Each test keeps the original's scenario: a scratch tree (`scratch()`, a copy of the repo's published contract data and
its `contracts/` folder), the fixture release cut by the step's own `record`, the candidate R2, each method's name,
shape and `since`, the tracking issue `#139`, the reshaping (`type` retyped from a string to an integer), the planted
step chosen as the original chooses it (`diff-preview`), and every assertion, message and failure pattern, through
139's helpers imported unchanged. One thing changes, in one local function (`dated`): a preview entry's row is 139's
`apiEntry` row plus `preview_since` and `decide_by`. The `describe` titles are the originals' word for word, since each
names its criterion and not the tests under it. Each `it` title is the original's with its criterion's ID in front and
"(redraft 1802)" at the end.

| Preview entry | In #139's test | In the redraft | The rest of the test |
|---|---|---|---|
| deep.preview, in the reshaped test and its planted twin | `since` R1, preview, tracking `#139` | The same, plus `preview_since` R1 and `decide_by` R3; R1 records it with both | As it was: R1 recorded, `type` retyped, `check --release R2` with no break file; exit 0, a PASS line and no FAIL line; on the planted step the scenario throws the same message |
| deep.orphan, in the third tree of its test | `since` R2, preview, tracking `#139`, called by no shipped piece | The same, plus `preview_since` R2 and `decide_by` R3 | As it was: the stable orphan fails in one FAIL line naming it and "no shipped piece", and called by a shipped piece it passes. Neither of those two trees plants a preview entry |
| deep.untracked, on both sides of its test | `since` R2, preview; no tracking issue on the failing side, `#139` on the passing side | The same, plus `preview_since` R2 and `decide_by` R3 on both sides | As it was: the failing side fails in one FAIL line naming it and "tracking", and the passing side passes |

## Kept as they are

Seven of the eleven tests of `tests/acceptance/139/preview.test.ts`:

- `tests/acceptance/139/preview.test.ts` › #139.607ef4f7 a preview method reshaped passes the diff; a stable package
  that calls it is refused at install; the same method stable fails; a stable method no shipped piece calls fails › AC3
  the same method marked stable fails the diff without a break file, naming it. It publishes deep.preview stable, and
  #1802 puts the two fields on preview entries only (in 1802's suite a stable row has no `tracking`, `preview_since` or
  `decide_by`). It expects a failure naming deep.preview, which a reshaped stable method still is.
- The five install tests. Under #139.607ef4f7 a fixture package that declares itself stable and calls a preview method
  is refused at install, naming the method: AC3 a package that declares itself stable and calls the preview
  deep.provide is refused, naming deep.provide, and is not loaded; and AC3 (wrong program) a host that lets the stable
  package call a preview method installs it, and this test fails it. Under #139.b9c5c209 a preview entry names its
  tracking issue, and is used only by name: a package or a document lists it in requires.preview, or it is refused with
  preview_unrequested: AC13 a package that uses a preview method without listing it in requires.preview is refused with
  preview_unrequested, naming the method; AC13 one that lists it in requires.preview installs, and is not a stable
  package; and AC13 one that lists it and declares itself stable is refused, naming the method and stable. Each hands
  the extension host a published API in memory (`api: previewApi()`) in which deep.provide is a preview with a tracking
  issue, and none runs the contract step. #1802's rule is the preflight's: its criterion and the design both say "fails
  the preflight", and 1802's suite puts it in the step's `check`. No sentence of either issue or of the design has the
  host refuse an install because a row of the API it was handed lacks `decide_by`. So each refusal and each install is
  still what a correct program does.
- Under the same #139.b9c5c209 describe: AC13 a document that uses a preview kind without listing it is refused with
  preview_unrequested, naming the kind; listed, it passes. It publishes the kind `sparkle@1` as a preview schema with a
  tracking issue, cuts R1 with `record` and runs `document <file> --release R1`. It never runs `check`. `record` cuts a
  fixture release, and `document` is #139's `requires.preview` rule, which #1802 keeps as it is ("a document must ask
  for it by name (#139, closed)"). No sentence has either fail an undated preview entry.

The rest of `tests/acceptance/139/` was not read. By its README (Criteria to tests), its helpers and its REDRAFT.md:

- `prices.test.ts` (four tests, `#139.06ef013d`) hands the host `api: previewApi()` with deep.provide, deep.use and
  deep.read preview and tracked: the install path again, kept for the install tests' reason.
- `history`, `oldload`, `since`, `budgets`, `corpus`, `apisurface`, `classify` and `deprecated`: their criteria name no
  preview entry, and the scenes the helpers give them (`releasesR1R2`, `releasesWithEarly`, oldload's `cutR1`) publish
  stable methods. Whether one of them plants a preview entry of its own for `check` to pass, this job could not read.
  One that does needs this same change.

Every test, kept or redrafted, that expects `check` to pass on a scratch tree stands on the repo's own published
entries passing the step, since the tree copies them (Readings, The scratch tree's own entries).

## Readings

- **"The preflight"** is the contract step's `check --release R`, as #139's README and 1802's suite both read it. An
  install, `record` and `document` are not it.
- **The two fields** are on the API row beside `tracking`, under the names the issue gives, as 1802's README has a
  preview entry's published row. `preview_since` is the release the scene first publishes the entry in, its `since`:
  R1 for deep.preview, R2 for deep.orphan and deep.untracked.
- **`decide_by` is R3** for all three. Releases are counted by their numbers, as 1802's suite counts them. Every
  scene's candidate is R2. R3 comes after it, so no entry is due in the candidate (#1802: "In a fixture release that is
  an entry's `decide_by`, the preflight fails"), and it is 2 releases after R1 and 1 after R2, inside the cap of 3. It
  is the earliest release that isn't due, because #1802's Scope marks the cap "drafted; your decision": a cap lowered
  to 2 still passes these. deep.preview's dates are ones 1802's own suite expects to pass in the same position
  (`ac5-…`: a preview since R1 to be decided by R3, recorded in R1, passes `check --release R2`).
- **R1 records what the candidate publishes.** deep.preview's `decide_by` is the same in the recorded R1 and in the
  candidate, since 1802's suite fails a `decide_by` that moved with no extension on record.
- **The untracked entry is dated too.** Its failing side would still fail undated. Dated, the missing tracking issue is
  the only thing wrong with it, and the two sides differ in that alone, which is what "with one it passes" claims.
- **The scratch tree's own entries.** `scratch()` copies the repo's published data, as in the original, so each tree
  also holds the repo's own preview entries: at the base 118 of the 470 entries it copies (41 API methods, 56 JSON-RPC
  methods, 16 schemas, 4 interfaces, 1 registry), none with either field. The passing sides here pass only once those
  carry both fields with none due in R2, which #1802's implementation owes the repo's own preflight (1802's README:
  "the repo's `contracts` lane fails until they do"). The redraft neither dates nor drops them. That would change the
  scene more than #1802's rule requires, every other passing side on a scratch tree in the frozen suite stands on the
  same ground, and no issue or suite names the two fields on a schema, a JSON-RPC method, an interface or a registry.
- **The planted step** is chosen as the frozen suite chooses it, by `DEEP_CONTRACTS_PLANT=diff-preview`, which the
  base's step still takes. The design's Wrong programs keeps a planted program out of environment variables; #1802's
  rule doesn't touch that, so the redraft doesn't either.
- **The twin throws on any exit but 0**, as the original does. It tells the planted step from the right one only on a
  tree the right step passes. Tightening it is not something #1802's rule requires, so it is as it was.

## Wrong programs they still fail

- A step that diffs preview entries (`diff-preview`): it asks for a break file for the reshaped deep.preview. The first
  test fails on it with the criterion's message, and the second expects exactly that.
- A step with no rule for a stable method nobody calls: the third test fails at "a stable method nobody calls".
- A step that holds a preview entry to the shipped-piece rule: the third test fails at "the same method published as
  preview".
- A step with no tracking rule: the fourth test fails at "a preview entry with no tracking issue".
- A step that fails every preview entry, tracked or not: the fourth test fails at "the same preview entry with its
  tracking issue".

#1802's own rule is not tested here. No test in this file expects a failure for a missing `decide_by`; that is
`tests/acceptance/1802/ac1-…`.

## On the base

Nothing was run at `eee08d40a`. One request for a throttle grant (`node scripts/throttle.mjs build --wait 15 -- npm ci`)
ended with no grant, so there is no `npm ci`, no build, no typecheck and no vitest run. The test file passes
`node --check`, syntax only. `BASE-FAILURE.txt` has what was not run and what each test is expected to do at the base,
from the base's code and data as read:

- The base's step reads neither field, so each redrafted test does at the base what its original does there. The base
  is #139's program, the right one for these criteria, and none of the four is expected to fail it for want of #1802.
- On a scratch tree whose own entries pass the base's step, all four pass.
- As read, they don't pass it: 14 of the repo's own preview entries (11 schemas, 3 interfaces) carry no tracking issue,
  which the base's step fails on every scratch tree. So the reshaped test and the passing sides of the other two are
  expected to fail at the base, as the frozen originals are, and the planted twin to pass. That is neither #1802's doing
  nor this redraft's, and no run confirmed it.

## Run it

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the contract step imports packages/contracts/dist
node node_modules/typescript/bin/tsc -p tests/acceptance/139-redraft-1802/tsconfig.json
node node_modules/vitest/vitest.mjs run --root tests/acceptance/139-redraft-1802 --testTimeout=600000 --no-file-parallelism
```

Node 24.22.0. The file runs the contract step on scratch trees and starts no hub, host or cargo build. It imports
`tests/acceptance/139/helpers.ts` unchanged, which gives the process a temporary `HOME`, takes `CLAUDE*`, `DEEP_*` and
`AI_AGENT` out of its environment and deletes every folder it made. This folder has no `helpers.ts`: the one helper it
needs, `dated`, is one function in the test file.

## At merge

The frozen `tests/acceptance/139/` stays as written. The owner's call is to swap four tests of its `preview.test.ts`
for the four here, and to keep its other seven.
