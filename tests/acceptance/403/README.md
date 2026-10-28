# Acceptance tests for #403: document checks, check kinds through one registry, and verdicts on the work

Written first, from issue #403 ("Document checks: the core's check kinds, module kinds through one registry,
and verdicts on a document that is the work": its scope, its Check input fields, its three acceptance
criteria and its proof line), the design sections it names and those they lean on, and base commit `a8e5480`
("Merge pull request #767 … feat/63-read-by-reference"), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job.

What was read:

- `docs/technical-design.md`: Pinned to a commit (286: "A verdict on a document that is the work also pins to
  that document's revision hash and to the revision of each document it shows, so any writer's patch to
  either marks it stale as a new commit would"); Canvas modules and packs (1058, 1087: `module_missing`);
  Patch, Render-back and Document check (1476–1529: "It can never: Pass a claim on its own unless the document
  is the work; keep a revision from showing for an issue its last good revision already had, which a verdict
  still counts"); What done means, fixed at the start (2063: requirements, checks, the claim's verdict); An
  agent says it's done and Stale results stay stale (2098–2127).
- `docs/canvas-primitives.md`: Revision (468: the revision `hash`, carried issues, "A check that decides a
  verdict still counts every issue"); Registries and closed lists (1241: "Document check kinds | Check input |
  registry `check.kind.doc@1`, declared by the core, holding the core's own kinds and filled by canvas
  modules | A code catalogue with a planted twin per code"); What holds a document to its rules (8165: "In a
  claim, an item skipped as `unknown_kind` makes the document's checks BLOCKED, naming the kind, as a missing
  canvas module does"; a document check passes a claim only when the claim's definition names it among its
  deliverables); Check input (8169: the core's eleven kinds, "`logic.determinism` and `logic.budget` the logic
  module's", "It can never: Use a picture as proof; be skipped for an agent's document"); Check input: logic
  kinds (8432: `logic.determinism {at_times, compare}`).
- At the base: `crates/deep-show` (`deep-show run`, its scenario with `claims`, `deep show --check` and its
  `result`, `planted`, the `registry`, `manifest` and `catalog` calls, its `test-*` Cargo features),
  `crates/deep-canvas/src/registry` (`Registrar::check`, `KNOWN_MODULES`), `crates/deep-canvas-test-modules`,
  and the earlier blind suites `tests/acceptance/371/`, `305/`, `138/`, `383/`, `393/`, `389/` and `96/`
  (READMEs, helpers, tests, BASE-FAILURE files). Code was read to learn the surface; every expected value
  comes from the issue and the design.

## Run them

Like #371's suite they build `deep-show` per Cargo feature set, so they run with `--no-file-parallelism`
(`scripts/lanes.mjs` needs `tests/acceptance/403/**` added to the unit lane's `--exclude` list and
`tests/acceptance/403/` to its one-at-a-time line, as #371's README says for its own; this job edits nothing
outside this folder):

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/403 --no-file-parallelism
npx tsc -p tests/acceptance/403/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full[,<test
feature>]` for each build it lists, copies each binary to a temporary folder, and fails each test whose build
failed. Each test opens an evidence store in a temporary folder and deletes it. The tests use only node
built-ins and vitest. A run with `--root tests/acceptance/403` leaves Vitest's cache in
`tests/acceptance/403/node_modules/.vite`; delete it. `BASE-FAILURE.txt`, the run at the base with a header
saying why each test fails there, is still to be produced: the drafting job could not run cargo builds.

## The surface under test

The issue names check inputs, the check registry `check.kind.doc@1`, `module_missing`, claims, briefs and
their requirements, deliverables, verdicts and their keys, and test canvas modules, but no new command. These
tests reuse `deep-show run` (#393's scenario binary standing in for the hub's canvas side) with everything
#393's, #96's, #305's, #138's and #371's READMEs define for it: the JSON-lines convention and `bad_input`,
sessions, the process table and its peer check, panels, `claims` with `deliverables`, whole revisions and
patches (`deep_show` / `deep show` with `document` or `patch`), shared documents stored in
`docs[…].document` (opened as revision 0, current), `read`, `revisions`, `deep show --check` (`check: true`)
with `claim` and its `result`, `--snap` (`include: ["pixels"]`) and `snapshots`, `registry` (its `modules`),
`manifest` (its `check_kinds`), `catalog` (its `codes`), the `full` build set and `test-*` features. What
follows adds to it, as little as the criteria need.

### Claims with requirements (scenario field)

```json
"claims": {claim handle → {"session": session ID, "deliverables": [doc ID],
                           "requirements"?: [{"id": req handle, "check": CheckInput}]}}
```

The scenario's claim stands in for a locked definition of done made from a brief: each requirement holds one
check input, the issue's `{kind, probe, at_times, expect, tolerance, except, render, sweeps, declared_cuts}`
plus a kind's own fields (`logic.determinism`'s `compare`). `kind` is read against the build's document check
registry: the core's eleven kinds and those the build's canvas modules register. A requirement's check runs
on the current revision of each of the claim's deliverables.

### The `verdict` and `verdicts` calls

`{"call": "verdict", "claim": claim handle}` judges the claim now and records the verdict:

```json
{"result": "PASS" | "FAIL" | "BLOCKED" | "INVALID" | "INCONCLUSIVE",
 "key": {"revisions": [{"doc": doc ID, "rev": u64, "hash": sha256}], …},
 "stale": bool,
 "requirements": [{"id": req handle, "kind": check kind, "result": verdict, "blocked"?: [Blocked], "issues": [Issue]}]}
```

- `key.revisions`: one row per deliverable (and per document it shows), the revision it judged and that
  revision's `hash`, the one `revisions` gives. The key's other parts (commit, check digests, environment,
  tools) are the implementer's and not read.
- `stale`: true when any document in `key.revisions` has a current revision other than the one named there,
  as a new commit makes a verdict on an earlier commit stale.
- `requirements`: every requirement of the claim, none skipped. A requirement is PASS when its check ran on
  every deliverable and raised no error, FAIL when it raised one (its `issues`, #389's issue shape), and
  BLOCKED when it couldn't run: its check kind is one no module in the build registers, or a deliverable
  holds an item skipped as `unknown_kind`. The claim is never PASS while a requirement isn't.

`{"call": "verdicts", "claim": claim handle}` → `{"verdicts": [Verdict]}`: every verdict `verdict` made on
the claim, in the order made, each as recorded with `stale` as of this call.

### `blocked` (reply field)

`Blocked = {"code": "module_missing" | "unknown_kind", "kind": string, "module"?: string, "ids": [ID]}`: why
a check is BLOCKED for a kind. On a requirement row, and on a `deep show --check` reply with `claim` whose
`result` is BLOCKED:

- `module_missing`: `kind` the check kind no module in the build registers, `module` the canvas module whose
  kind it is when the design names it (`logic` for `logic.determinism`), `ids` empty;
- `unknown_kind`: `kind` the item kind this build doesn't know, as the item gives it (`test.cube@1`), `ids` the
  items of that kind.

A `deep show --check` with a `claim` whose deliverables name the document, of a revision holding an
`unknown_kind` item, answers `result: "BLOCKED"` with that `blocked`; the revision is still presented and its
known items draw.

### Catalog rows add `check`

Each `catalog` row adds `"check": check kind`, the check kind that emits the code.

### `planted` values added (scenario field, each reachable only through it)

| Value | Criterion | The wrong program |
|---|---|---|
| `verdict_keyed_by_doc` | AC1 | a verdict's key names each deliverable by doc ID alone, with no revision, so no patch makes it stale |
| `checks_skip_unknown_kind` | AC2 | checks in a claim skip an `unknown_kind` item, as outside a claim, and judge the rest |
| `missing_kind_inconclusive` | AC3 | a requirement whose check kind no module in the build registers is INCONCLUSIVE |

### Test builds: Cargo features on `deep-show`, each joining the `full` set

As #305's, #371's and #388's suites add theirs (never in a shipped build):

- **`test-leave-out-logic`**: the `full` set with the `logic` canvas module left out of the build's module
  list, as #388's `test-leave-out-look` leaves out look. While `full` holds no logic module it changes
  nothing; it keeps "a build without the logic module" true once one lands.
- **`test-check-kind`** → canvas module `test.checks` (in `crates/deep-canvas-test-modules`), registering the
  document check kind `test.checks.named` and no item kind. The check reads every item's `name` and runs
  only when a check input names it (not before a show). Its codes, in the catalog with module `test.checks`,
  check `test.checks.named`, a meaning, a fix and a planted fixture each, as #138's kit requires:
  - `test.checks.todo` (error) on each item whose `name` is `TODO`, `ids: [item]`, `path: items/<id>/name`;
  - `test.checks.shout` (warning) on each item whose `name` is eight or more upper-case ASCII letters.

## Criteria to tests

Each test's name starts with its criterion's tag, `#403.` and the first 8 hex digits of the SHA-256 of the
criterion's text, trimmed and whitespace collapsed (as `scripts/proof-change.mjs` computes it from the
issue's `- [ ]` lines), then its ID; each file's head quotes its criterion and names in `asserts` the
assertions that carry it.

| ID | Tag | Criterion | Tests (count) |
|---|---|---|---|
| AC1 | `#403.b719566f` | A PASS on a document that is the work goes stale when any writer's patch makes a new revision of it, as a new commit would, and the verdict's key names that revision's hash | `stale.test.ts` (5), on `full`: for your patch, alpha's (the claim's own agent) and bravo's, each in its own run: the claim on the stored board is PASS on revision 0, not stale, keyed by revision 0's hash; the patch applies as a new current revision with another hash; `verdicts` lists the PASS as stale, still keyed by revision 0's hash; a verdict made then is PASS, keyed by the new hash, not stale (`staleFailures`). Without a patch the PASS stays fresh. `verdict_keyed_by_doc` fails `staleFailures` naming alpha's patch |
| AC2 | `#403.a04e255b` | A deliverable document with an item of a kind this build doesn't know makes its checks in the claim BLOCKED naming the kind, never PASS, while the rest of the document still draws | `unknown-kind.test.ts` (4), on `full`: `deep show --check --snap` from alpha's tree of alpha's board with a `test.cube@1` item, for alpha's claim naming it: presented, its snapshot byte for byte the board's without the item and not an empty board's, `result` BLOCKED with `blocked` naming `unknown_kind`, `test.cube@1` and `cube`; the claim's `document.validate` requirement BLOCKED the same way, the claim not PASS; control: without the item, both PASS; `checks_skip_unknown_kind` fails naming `test.cube@1` |
| AC3 | `#403.f915741c` | In a build without the logic module, a brief whose check input names logic.determinism leaves that requirement BLOCKED with module_missing, naming the kind and the logic module, never PASS or INCONCLUSIVE; and a test canvas module that registers a check kind adds it to the check input's kinds and to the catalog with its codes | `check-kinds.test.ts` (4): on `full,test-leave-out-logic` (no `logic` in `registry`), the `logic.determinism` requirement is listed BLOCKED with `module_missing` naming the kind and `logic`, the claim neither PASS nor INCONCLUSIVE, its `document.validate` requirement PASS; `missing_kind_inconclusive` fails naming `logic.determinism`; on `full,test-check-kind`, `check_kinds` holds the core's eleven and `test.checks.named`, the catalog both codes with module, check, meaning and fix, and `full` neither; the `test.checks.named` requirement is PASS on the clean board and FAIL with `test.checks.todo` on `you.todo` there, and BLOCKED with `module_missing` naming the kind in `full` |

## Readings where the issue and design leave a choice

- **"The verdict's key names that revision's hash."** Read as the revision the verdict judged: the PASS made
  on revision 0 is keyed by revision 0's hash, which is why the next revision makes it stale, and a verdict
  made on the new revision is keyed by the new revision's hash. Both are asserted.
- **"Any writer's patch"** is three writers' patches (#96's): yours from your shell (a `set` on your item),
  the claim's own agent's and another agent's (each a `create` of its own item), each through #96's patch
  call on base 0. Whole revisions aren't tried.
- **"Goes stale … as a new commit would"** is `stale: true` on the recorded verdict (Pinned to a commit; Stale
  results stay stale). The recorded verdict keeps its `result`; only `stale` is read.
- **"A brief whose check input names logic.determinism"** is a scenario claim's requirement holding that
  check input: no drafting job or definition lock exists in `deep-show`, and the issue names none. Its board
  holds no logic item, so the requirement is BLOCKED by the missing check kind alone and not by a
  `module_missing` the document itself raises (#305's).
- **"Naming the kind and the logic module"** is a `blocked` row with `code: module_missing`, `kind:
  logic.determinism` and `module: logic`. For `test.checks.named` in `full` the module isn't read: a build
  that doesn't hold `test.checks` has nothing that says which module a kind under `test.` would be.
- **"Never PASS or INCONCLUSIVE"** is asserted on the requirement (exactly BLOCKED) and on the claim (neither
  PASS nor INCONCLUSIVE). "Never skipped" (the scope) is the requirement having its row.
- **"Its checks in the claim"** is read both on `deep show --check` with the claim (the base's surface) and on
  the claim's requirement. Outside a claim an `unknown_kind` item stays a notice (#389); that isn't read.
- **"The rest of the document still draws"** is the snapshot of the board with the unknown item being byte for
  byte the snapshot of the same board without it, and not an empty board's: a skipped item draws nothing.
- **"Adds it to the check input's kinds"** is the manifest's `check_kinds` (#138: "the document check
  registry's kinds") holding it beside the core's eleven, and a check input naming it running: PASS on a
  clean board and FAIL naming the item it flags. **"To the catalog with its codes"** is a catalog row per code
  with module `test.checks`, the new `check` field and a non-empty meaning and fix.
- **The core's kinds reading only the core's arrays** (the scope's first half) is a property of the core's
  code no criterion asks to observe; it isn't tested here beyond the eleven being in `check_kinds`.

Not tested, because no criterion asks: "a check that decides a verdict counts every issue, carried ones
included" (the scope's second bullet; #371's suite left it too), a verdict pinned to the revisions of
documents it shows, `logic.budget` and the other module kinds, plug-in check kinds (`check.kind@1`), the
catalog's planted twin per code, and a code the catalog doesn't list making a check INVALID.

## Upstream tests (the Oracle lane)

The issue says no engine's or project's own test checks these criteria and links its Oracle page,
`doneright/oracles/issues/403.md` in DeepBuildAI/deepbuild, which isn't reachable from this machine, so the
drafting job didn't read it. These tests are the criteria's local proof.
