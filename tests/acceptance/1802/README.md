# Acceptance tests for #1802: a preview ends

Written first, from issue #1802 ("Preview entries end: a decide-by release on every preview entry, and a release
that carries an overdue one fails": its Scope, its ten acceptance criteria and its Proof line), the design sections it
links, and base commit `50cf3043c` (origin/main `1c4d1f0e2` plus the docs-only commit that appends the issue's rule to
`docs/technical-design.md`), by a job that never saw an implementation; none existed, and no other worktree, branch or
pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding). Lean: one test per criterion's claim, plus one for each wrong program a
criterion names.

## What was read

- The issue, live with `gh issue view 1802` (`updatedAt` 2026-11-12T18:26:12Z); for scope only, its epic #241 and the
  closed issues it builds on, #139 and #1956.
- `docs/technical-design.md`: Socket roles and contract versions (Contracts that can't drift, which ends with the
  sentences from "A preview ends."; What a minor may change; Version skew; Documents that age well); the MCP tools row
  of Five ways in (the `deep_kinds` paragraph); Ask, Decision and rule, and the Decisions rows Who answers a project's
  asks and Ask deadlines and defaults; How we know version 0 works (Frozen contracts, with the break-file sentences;
  The ecosystem corpus; Criteria to tests, both ways; Criteria in a checked shape; Wrong programs; Dogfooding; Tests
  written first); the Decisions row Contract history.
- `docs/canvas-primitives.md`: Document envelope (`requires.preview`, `preview_unrequested`); Migration; Registry and
  seal: registries; Pack: migrations as data.
- `AGENTS.md`.
- At the base, for the surfaces these tests extend: `scripts/contract-diff.mjs` and its suite `tests/acceptance/139/`
  (README, helpers, `history`, `preview`, `corpus`, `prices`); `contracts/shipped.json`, `contracts/corpus.json`,
  `packages/contracts/extension-api.json`, `rpc-methods.json`, `canvas-schemas/kinds.dump@1.json`;
  `packages/hub/src/contracts.ts` and the hub's public entry; `packages/asks/src/index.ts` and `model.ts` (`raise`,
  `answer`, `card`, `needsYou`, `inbox`, the card's options and plan), `packages/extension-host/src/host.ts` (how the
  update ask is raised and waited on), `packages/record/src/index.ts` (`openRecord`, `Connection`);
  `crates/deep-show/src/kinds.rs` (the listing's entries, `stability` and `tracking`), `main.rs` (the calls),
  `kit/mod.rs` and `kit/migration.rs` (`corpus_record`, the migration part's cases), `frames.rs`, `query.rs`;
  `crates/deep-canvas/src/registry/mod.rs` (`preview`), `schedule/core_ops.rs` (the lowered form);
  `crates/deep-canvas-test-modules/src/kinds.rs` (`test.preview`); `scripts/proof-change.mjs` (`criterionId`,
  `readIssue`, how a test's title is read), `scripts/proof-runs.mjs` (failing at an assertion, `twins.json`),
  `scripts/lanes.mjs`; the suites `412`, `138`, `1956`, `1115`, `2201`.

## Run them

`ac4-…` and `ac6-…` build `deep-show`, so the folder runs alone: `scripts/lanes.mjs` needs `'tests/acceptance/1802/'`
in its `alone` list. This README is the instruction; the implementer makes that edit.

```sh
npm ci && npm run build --workspaces     # once: the contract step imports packages/contracts/dist
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1802 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1802/tsconfig.json
```

Node 24.22.0. Eight files need no cargo build: they run the contract step on fixture trees, and `ac5-…` also opens a
record and the asks core in process. `ac4-…` builds three feature sets of `deep-show` and `ac6-…` one of them (`cargo
build --locked --bin deep-show --no-default-features --features full,<feature>`, honoring `CARGO_TARGET_DIR`, with
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set), each copied out of the target folder under its own
name. Every temporary folder is deleted. The step's children get a temporary `HOME` and none of the agent's `CLAUDE*`
or `DEEP_*` variables. No process outlives the call that started it. No network. Every `it` passes an explicit
timeout.

A tool that is missing is `BLOCKED:`, never a pass: `packages/contracts/dist` not built, the step's own BLOCKED line,
or `cargo` not on the `PATH`.

## The surface under test

The issue names `preview_since`, `decide_by`, `requires.preview`, `deep_kinds`, `scripts/contract-diff.mjs`,
`contracts/breaks/<from>_<candidate>/`, the release notes and the corpus; it names no command, file layout, field of a
record or reply, option or planted name beyond those. **Every name below that the issue doesn't give is this job's
invention**, the smallest surface consistent with the design and the base. The implementer builds exactly these, or a
dispute goes to a blind redraft. What is marked **base** exists at `50cf3043c` and is only read.

### Releases

**Mine:** a release is named `R<n>`, as the design's are (R1, R2, R6) and as every `since` in the published data is.
`R<a>` is `a − b` releases after `R<b>`: R4 is 3 releases after R1, and R5 is 4.

### The contract step: `scripts/contract-diff.mjs <command> --release <R> --root <tree>` (base, #139)

The tests use `record`, `check` and `notes` on fixture trees. A fixture tree starts empty (`packages/contracts/
extension-api.json` `[]`, `contracts/shipped.json` `{pieces: []}`, an empty `contracts/releases/`), so none of the
repo's own preview entries, with whatever `decide_by` each comes to carry, is in a fixture release. Its entries are
extension API rows in the base's shape, `{method, variants, since, stability, tracking, digest, params}`; a fixture
method's params are one required integer, `threshold`, and its `digest` is the d1 digest of its params.

**Published data (mine):**

- A preview entry's row carries `preview_since` and `decide_by`, both releases, beside `tracking`. The tests read them
  on extension API rows only. A promoted entry's row is `stability: "stable"` with no `tracking`, `preview_since` or
  `decide_by`.
- `contracts/extensions.json`: the extensions on record, a list of
  `{"entry": "<kind>:<name>", "from": "<release>", "to": "<release>", "reason": "<text>", "ask": "<the ask's handle>"}`.
  `entry` is the step's key for the entry (`api:deep.trial`), `from` the `decide_by` it had, `to` its new one, which
  the entry's published `decide_by` then is. `check` reads the extension from this file in the tree, and from no
  record store.
- `contracts/shipped.json` (base: `{pieces: [{piece, calls}]}`, the candidate's shipped pieces): a piece row may
  carry `requires: {"preview": [name]}`, the preview entries it names, as a package's manifest and a document's
  envelope do.

**`check --release R` (mine, added to the base's rules).** Each is one `FAIL contracts:` line and exit 1; a FAIL line
names an entry by its name (`deep.trial`):

1. A preview entry with no `decide_by`, or whose `decide_by` is more than 3 releases after its `preview_since`, fails,
   naming the entry. An entry extended on record is held to 3 releases for the extension's `from` and 2 more for its
   `to`.
2. With R a preview entry's `decide_by`, the entry fails, naming it. It doesn't once the entry is stable, is gone, or
   has an extension on record whose `from` is R.
3. A promoted entry, one an earlier release recorded as a preview that the candidate publishes as stable, is in the
   break diff: its shape is diffed against each earlier release that holds it, as a stable entry's is. A change is the
   base's break line, `FAIL contracts: <entry>: … in the field <field> …`, with its `diff: <from>_<to> <key> <pointer>
   <what>` line under it.
4. A `decide_by` that differs from the one the latest earlier release recorded for the entry, with no extension on
   record for that move, fails, naming the entry.
5. For the candidate's pairs, `contracts/breaks/<from>_<R>/`: a break file that quotes a line that is in neither that
   pair's current diff nor a corpus decision's line fails. **One FAIL line holds the file's path under the root
   (`contracts/breaks/R1_R2/1802.txt`) and the quoted line verbatim** (`diff: R1_R2 api:deep.gone / removed`), both
   in that one line, since a line that starts `diff: ` is a current diff line a reviewer quotes. A line of the same
   file that is still in the diff is in no FAIL line.

**The break files the step used (base).** The passing run names each break file it used in its `ACCEPTED contracts:
<entry>: <pair>, reviewed in <file>` line. The tests read no other listing. A break with no file is the base's `FAIL
contracts: <entry>: …, a break of <pair> with no break file …` line.

**`notes --release R` (mine, added to the base's notes).** Generated from the tree: the earlier releases'
records, the candidate's published data, `contracts/extensions.json` and `contracts/shipped.json`. Exit 0. Each
promotion, removal and extension of a preview entry is an item: a line that starts `- `, with any lines under it
indented, as the base's break items are. The item names the entry and says `promoted`, `removed` or `extended`, and
names each shipped piece whose `requires.preview` lists the entry.

### The hub's public entry (`packages/hub`, mine)

```ts
extendPreview(options: {
  root: string;          // the contract tree
  record: RecordStore;   // the record the asks core writes
  asks: Asks;            // the asks core the ask is raised on
  entry: string;         // the step's key, "api:deep.trial"
  decide_by: string;     // the new decide_by
  reason: string;
}): Promise<unknown>
```

- It refuses at once, rejecting with an error whose message names the entry (`deep.trial`), raising no ask and
  changing nothing: when `decide_by` is more than 2 releases after the entry's published `decide_by`; and when the
  entry already has an extension on record.
- Otherwise it raises exactly one ask on `asks`: an authority ask, as the extension host's update ask is at the base,
  with one option that declares `allow`, one that declares `deny`, and a plan; its card names the entry. While the
  ask is open the promise is pending and the tree is as it was.
- On your yes on the trusted path it adds the extension's row to `contracts/extensions.json` (`from`, `to`, `reason`
  and `ask`, the ask's handle), sets the entry's published `decide_by` to `to`, and resolves. Any other close rejects
  and changes nothing.

The tests open a record and the asks core over it in a temporary folder (`openRecord`, `openAsks`, both base), and
answer as you: `asks.answer({writer: 'app', actor: 'you', scope: 'you'}, ask, {option, plan_hash, token})`.

### `deep-show` (base: `run`, the scenario, `deep_kinds`, `corpus_record`, `kit`, `deep show`)

**`deep_kinds` `list` (mine):** each registry or slot row and each entry whose `stability` is `preview` carries
`preview_since` and `decide_by`, beside `tracking`.

**Test features of `deep-show` (none in a shipped build):**

| Feature | What the build holds |
|---|---|
| `test-preview` (base, #412) | module `test.preview` 1.0.0, kind `test.preview.blob@1 {box}` drawn as a rect in the look's ink, a preview tracked by #412. **Mine:** it records `preview_since` R2, the `since` its entry lists, and `decide_by` R5 |
| `test-preview-removed` (mine) | module `test.preview` 1.1.0, which removed `test.preview.blob@1` with its migration: an item of it opens as `rect@1` with the same `box`, filled with the look's ink, so it evaluates and draws as the blob did. A preview entry is not breaking in any release, so the module keeps its major and a document that requires `test.preview` `^1` still opens |
| `test-preview-removed-bare` (mine, planted) | the same module 1.1.0, which removed the kind with no migration |

**A removed entry's migration (mine).** How a canvas module declares it is the implementer's. What the tests read:

- `deep show` of a document that lists the removed kind in `requires.preview` and holds an item of it opens with no
  error issue and a notice `{"code": "migrated", "ids": [<the item>], …}`, as the core raises for a module's kind one
  major back.
- The kit's `migration` part (`{"call": "kit", "modules": ["test.preview"], "parts": ["migration"], "corpus":
  <folder>, "param_sets": 10}`, base) of the module that removed an entry runs every corpus document in the folder
  that lists the entry in `requires.preview`, as one case named for the document (the corpus file's `name`), as it
  runs a document that holds one of the module's kinds at the base: `compared.times` is the file's sampled times,
  `compared.values` the number of recorded values compared, and the case passes when the migrated document gives the
  values and snapshots recorded.
- A removal with no migration is refused by that run: the module's verdict is `FAIL`, and a failure whose JSON holds
  the document's name, or the failed case named for it, names the document.

The corpus document is saved by the build that still has the kind, with `corpus_record` (base): `<corpus>/<name>.json`
with `document`, `times`, `values` and `snapshots`. The 20 sampled times are every eighth of a second from 0 s
(`0s`, `0.125s`, … `2.375s`), each a whole number of flicks.

## Wrong programs

No planted program is added to a shipped program, and none is chosen by an environment variable (design: Wrong
programs). Each lives in test code, is fixture data, or sits behind a Cargo test feature. `twins.json` maps each
criterion to the names below.

| Name | Criterion | Where it lives | What it does | How the test fails on it |
|---|---|---|---|---|
| `reports-only` | 2, 8 | `plants/reports-only.mjs`, run in the step's place | runs the repo's contract step, prints each `FAIL contracts:` line as `WARN contracts:`, exits 0 where the step exited 1 | criterion 2: R3 passes with deep.trial still a preview, so the check names deep.trial. Criterion 8: the restored tree passes, so the check names the file and the quoted line |
| `test-preview-removed-bare` | 4 | a Cargo feature of `deep-show` (the implementer's test module) | `test.preview` removes its preview kind with no migration | the kit must refuse it naming the document, and the check fails on it naming the document |
| `listing-without-preview-since`, `listing-without-decide-by` | 6 | `ac6-…`, test code | `deep_kinds`' own listing with that field left out of `test.preview.blob@1` | the check names the entry and the field |
| `note-drops-one` | 7 | `ac7-…`, test code | the generated notes with the items naming one entry dropped; each of the three in turn | the check names that entry and no other |
| `tree-keeps-stale-file` | 10 | `ac10-…`, a fixture tree | the stale break file is kept, so the second removal is quoted | the check that expects a break with no file fails, naming deep.gone |

A planted test holds the right program to the same check first, so a program that already fails the criterion can't
make its plant look caught. Every test is also expected to fail on the merge base at an assertion; no run confirmed
it (see `BASE-FAILURE.txt`).

## Criteria to tests

Each title starts with its criterion's ID, `#1802.` and the first eight hex digits of the SHA-256 of the criterion's
text, trimmed and white space collapsed (`scripts/proof-change.mjs`, `criterionId`, on the live issue body). The map
is `CRITERIA` in `helpers.ts`. Each file's head quotes its criterion and says what it asserts.

| # | ID | File (tests) | Wrong programs it fails on |
|---|---|---|---|
| 1 | `#1802.1c4f47ee` | `ac1-decide-by-cap.test.ts` (2): no `decide_by`; 4 releases after, with 3 passing | the merge base |
| 2 | `#1802.cca13350` | `ac2-decide-by-release.test.ts` (2): fails at R3 until stable, removed or extended; the planted preflight | `reports-only`; the merge base |
| 3 | `#1802.0d11e259` | `ac3-promoted-then-changed.test.ts` (1) | the merge base |
| 4 | `#1802.b8a0e044` | `ac4-removed-entry-migration.test.ts` (2): opens through the migration with the recorded values at 20 times; the planted removal | `test-preview-removed-bare`; the merge base |
| 5 | `#1802.9ef4dcb1` | `ac5-extension-ask.test.ts` (3): one ask, recorded on your yes; 3 releases later and a second extension refused; a patched `decide_by` | the merge base |
| 6 | `#1802.c5460f6b` | `ac6-deep-kinds-fields.test.ts` (2): both fields listed; the planted listings | `listing-without-preview-since`, `listing-without-decide-by`; the merge base |
| 7 | `#1802.9400be12` | `ac7-release-notes.test.ts` (2): the three items and the demos; the planted note | `note-drops-one`; the merge base |
| 8 | `#1802.18e8cff0` | `ac8-restored-method.test.ts` (2): the file and the quoted line; the planted step | `reports-only`; the merge base |
| 9 | `#1802.3f79e4e6` | `ac9-two-quoted-lines.test.ts` (1) | the merge base |
| 10 | `#1802.b515e798` | `ac10-removed-again.test.ts` (2): a break with no file; the planted tree | `tree-keeps-stale-file`; the merge base |

## Readings where the issue leaves a choice

- **How releases are counted** (1, 5). By their numbers, as above. The step can't count recorded releases, since a
  `decide_by` names one not cut yet.
- **"A fixture release that is an entry's `decide_by`"** (2) is the candidate `--release R3` over the recorded R1 and
  R2. Only that release is tested, not one after it.
- **"Stable, removed or extended"** (2). Stable is the row published stable and called by a shipped piece, as #139
  asks of a stable method. Removed is the row gone; no corpus document names a fixture method, so no migration is
  owed. Extended is the extension on record, written here as data in the shape `extendPreview` writes.
- **"Promoted and then changed in the same release"** (3) is the candidate that publishes the entry stable with a
  shape other than the one R2 recorded for it as a preview. The digest it froze at is its shape's in R2. The fixture's
  `digest` field follows its params, so only the diff against R2 can see the change.
- **The entry, the corpus and the migration** (4). The issue links the canvas reference's Migration, so the entry is
  a canvas module's preview kind, the corpus is Migration's (fixture documents with the values and snapshots their
  release recorded at sampled times, #138), and the check that refuses a removal is the kit's migration part, which
  the release preflight runs. "The same evaluated values at 20 sampled times" are the values the build that had the
  kind recorded at 20 times the fixture fixes; the test checks the saved file holds those 20 times and the blob's
  box at each. The document is still, so the 20 values are equal. "Naming the document" is the corpus file's name.
- **"An extension is one ask answered by a person"** (5). The ask is raised on the asks core, in process, by a hub
  export, as #139's update ask is raised by the extension host; a `deep` command over it is the implementer's. It is
  an authority ask: unanswered, it defaults to no. The reason comes with the request and is recorded with the row.
- **"An agent's patch to `decide_by`"** (5). The step can't see who edited a file. What it refuses is a `decide_by`
  that differs from the last recorded release's with no extension on record. Only the ask's answer writes that
  record, so an agent's edit of the field is such a patch. The fixture moves R3 to R4, inside the cap of 3, so only
  this rule can fail it.
- **"At most 2 releases later"** (5) counts from the entry's `decide_by`, not from its `preview_since`: R3 to R5
  passes and R3 to R6 is refused. An extended entry may so reach 5 releases after its `preview_since`.
- **"A listing that leaves either out"** (6) and **"a planted note"** (7) are the listing and the note themselves,
  so each is planted in test code from the program's own output, as #2201's scorer is.
- **"Each shipped demo that names a preview entry"** (7). The design has no "demo". A shipped demo is read as a
  shipped piece of the candidate, a row of `contracts/shipped.json`; it names an entry by `requires.preview`. The
  fixture's demos name the extended entry, the only one of the three still a preview in the candidate. Their rows
  also list it in `calls`.
- **"A later commit restores the method"** (8) is the method published again as it was, with the candidate still R2.
- **"The stale file"** (10) is the file the step called stale while the method was restored. The test asserts that
  first, then deletes the file, then removes the method again.

## Not tested, because no criterion reaches it here

- A forged row in `contracts/extensions.json`: the step reads the tree, and who wrote a file isn't in it.
- An agent's answer to the extension's ask (the asks core's trusted path, earlier issues'), your no, and the default
  at the deadline.
- A release after an entry's `decide_by`, the new `decide_by` coming due, and an entry with no `preview_since`.
- Each release's count of preview entries beside the last release's (Scope, no criterion).
- A break file used through a corpus decision's line, and a break file that quotes nothing.
- `preview_since` and `decide_by` on schemas, JSON-RPC methods, hub slots and registries in the published data, and
  the repo's own entries carrying them; the repo's `contracts` lane fails until they do.
- A migrated document with motion, a removed pack kind, and `deep-canvas`'s own `preview_unrequested` check.
- The MCP tool `deep_kinds` in `packages/hub`, `deep-show kinds --dump` and `kinds.dump@1`.

## Files

- `helpers.ts`: the criterion IDs, fixture trees, the step and the planted step, the asks world, the `deep-show`
  builds and calls.
- `plants/reports-only.mjs`: the planted step.
- `ac1-…` to `ac10-…`: one file per criterion.
- `twins.json`: each criterion's planted names.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: what was and was not run on the base commit, and why each test fails there. The vitest run
  and the typecheck were not run: no throttle grant came. Run both before anything else.

## For the implementer: `scripts/lanes.mjs`

`ac4-…` and `ac6-…` build cargo binaries, so this folder belongs in `scripts/lanes.mjs`'s `alone` list, as
`'tests/acceptance/1802/'`. The implementer makes that edit.
