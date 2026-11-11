# Acceptance tests for #1723: document checks reach a claim on a live hub, and deep show --check reads the record

Written first and blind at base de304b9ff from issue #1723 (updatedAt 2026-11-10T23:18:43Z), "Document checks never reach
a claim on a live hub, and deep show --check reads PASS with no run": its Scope, its four acceptance criteria, its Proof
and Depends on, by a job that never saw an implementation; none existed. The implementing agent does not edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- **The issue** and the three it depends on, all closed: #403 (the core's check kinds, `module_missing` for a kind no
  module in the build registers, a verdict on a document keyed by its revision hash and stale on any writer's patch),
  #1537 (the review, numbers and work kinds held as `check.kind@1` fills and run by a gate) and #806 (`deep_show` through
  the hub's `deep mcp`, `deep show` from an agent's process tree, the record holding each revision by hash).
- **`docs/technical-design.md`**: How runs become one of five verdicts (precedence, pending, "a check runner returns one
  of these, never a verdict", stale results), Document check, Checks for work beyond code, What done means, fixed at the
  start, An agent says it's done, and the Dogfooding bullet.
- **`docs/canvas-primitives.md`**: What holds a document to its rules ("a document check passes a claim only when the
  document is itself the work"; a reply's `deep show --check`), Check input (the core's eleven kinds, `logic.determinism`
  the logic module's), the `module_missing` refusal, and `check.kind.doc@1` in Registries and closed lists.
- **The base's code**, for its surfaces only: `packages/hub/src/core.ts` (`checksOf`, which keeps only entries with a `run`
  string; `specChecks`; `runClaim`; `runCheck`, deep_run; `show`, `showCli` and `recordRevision`, the canvas side;
  `mcpCall` and `bind`), `packages/hub/src/canvas.ts` (`canvasCore`: the newer of the checkout's `target/release` and
  `target/debug` deep-show; the world it hands the canvas core holds claims only from a test's world file),
  `packages/hub/src/show.ts` (`deep show`), `packages/hub/src/tools.ts` (the `deep_run` and `deep_show` schemas),
  `packages/hub/src/runs.ts` (`run.started`, `run.finished`), `packages/hub/src/ask-tasks.ts` (the handed definition's
  lock and its claim), `packages/gate/src/floor.ts` (the validity gate reads deliverables as files),
  `packages/verdicts/src/engine.ts` (a requirement no check covers is INVALID), `packages/record/src/projections.ts`
  (`verdict.stale`), `crates/deep-show/src/hub.rs` (`Hub::verdict`, and the show reply's `result`), `verdict.rs` and
  `geometry_audit.rs` (the canvas core's verdict on a world-file claim), `crates/deep-canvas/src/geometry_audit.rs`
  (`geometry.floating`), and `crates/deep-show/src/main.rs` (`full` holds no `logic` module; `test-leave-out-logic`).
- **The sibling suites**: `tests/acceptance/1537/`, `403/`, `806/`, `1718/`, and `322/` and `405/` that they lean on.

## How to run

With Node 24 first on `PATH`, `git`, and the Rust toolchain the repo pins:

```sh
npm ci                                                   # once
scripts/lease npm run build --workspaces                 # the hub, deep mcp and deep show the tests start
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease cargo build --locked -q -p deep-hook   # every hook runs it
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease cargo build --locked -q -p deep-show   # the hub's canvas core
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1723 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1723/tsconfig.json
```

The tests build nothing: a missing build fails the test `BLOCKED`, naming the command. Each test starts its own hub, so
the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`), beside #322's and #1537's; the implementer
adds it. No network, no model, no paid call, no `gh` login. Every process runs with `HOME` a temporary folder (#322's
`makeWorld`, under `/tmp/dh322-*`, so the socket path fits in 104 bytes), and the real `~/.deepbuild`, `~/.claude` and
`~/.codex` are never touched. Each test stops only processes it started, by PID (#322's `cleanup`), and deletes its
folders.

## The surface

The issue names the surfaces: a claim's `.deepbuild/done.yaml` spec entry naming a document check, the real hub's gate
and record, `deep_run` through the hub's MCP, and `deep show --check`. Where it names no exact field, the tests pin the
smallest one consistent with the base's conventions.

### Pinned here: the implementation must provide these

1. **A document check entry in the spec.** `.deepbuild/done.yaml` names it under `checks`, as it names a command check,
   and `claims.done.checks` lists it by name:
   ```yaml
   claims:
     done:
       checks: [scene-audit]
   checks:
     scene-audit:
       kind: geometry.audit              # an entry of check.kind.doc@1
       doc: "01JB1723D00000000000000001"   # the deliverable document, by doc ID (26 letters and digits, as deep_show takes it)
       input: {"scope":"scene","support":{"floating":["floor"]}}   # the Check input's other fields
   ```
   No `run` and no `type` line: the entry's `kind` makes it a document check. In a trusted project the gate runs it as one
   of the claim's spec checks, through the canvas core, on the claim's revision of that document: the revision current
   when the claim is made.
2. **Its run in the record.** `run.started` with `data.claim` the claim's handle and `data.check` holding the entry's
   name; `run.finished` with the same `data.run`, `data.outcome` `passed` or `failed` as the canvas core's check of that
   revision passes or raises an error, and `data.evidence` a list of hashes in the hub's evidence store
   (`<hub root>/evidence`), one of them the check's issues as JSON text in the canvas core's issue shape (`code`, `ids`).
3. **A FAIL that names the item.** The claim's `verdict.made` data names the failing item's ID (in its reasons, its
   smallest case, its requirements or its open items).
4. **`module_missing` in the record.** A document check whose kind the build lacks makes the claim's verdict BLOCKED, and
   that verdict's data, or the check's `run.finished` data, holds the text `module_missing`.
5. **Stale on a new revision.** A revision of a document a PASS was judged on appends `verdict.stale` naming that
   verdict (`data.verdict` = the PASS's `verdict:<id>` handle, as for a new commit).
6. **deep_run.** `deep_run {check: <entry name>, claim: null}` runs the document check for the newest claim on the
   document's current revision, answers as for a command check (`{run, claim, outcome, evidence}`), and records the run
   as in 2.
7. **deep show --check.** The reply's `result` comes from the recorded runs. With `--claim <claim>`, presenting a
   document whose recorded run of the claim's check failed reads `FAIL`. A presented document with no run has a `result`
   that isn't `PASS`.
8. **A build without `logic`.** The canvas core the hub runs (the newer of `target/release/deep-show` and
   `target/debug/deep-show`) whose `registry` lists no `logic` module. The base's default `full` set holds none, so the
   default build is one; once a logic module joins `full`, build deep-show with `--features test-leave-out-logic`, which
   the base already has. AC3's test reads the registry first and is BLOCKED if `logic` is there. No plant is added.

### Merged surfaces, used as they are

- `deep hub run` in a temporary HOME with #322's test settings (`DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS`,
  `DEEP_HUB_TEST_WORK`, `DEEP_HUB_TEST_GITHUB`) and the project trusted by #348's decision, through #322's `makeWorld`,
  `trustRepo` and `startHub`.
- A Claude Code session played as #322 plays one: its transcript, and SessionStart, UserPromptSubmit, PreToolUse and
  PostToolUse of a Write, and Stop through the real deep-hook, each a child of the session's own process
  (`fixtures/agent.mjs`). Its `deep mcp` is that process's child too, so the hub binds it to the session (#806), and
  its `deep show` runs through a shell that process starts.
- `deep_show {doc, document}` (a whole revision as JSON text) through the session's `deep mcp`; `deep_run {check,
  claim}` likewise.
- `deep show --doc <id> --document <file> --json [--check] [--claim <claim>]`, run in the session's process tree.
- The record through the hub's socket (`events.read`): `user.ask`, `definition.locked`, `claim.made`, `run.started`,
  `run.finished`, `verdict.made`, `verdict.stale`, `doc.patched`. Evidence through `packages/evidence`'s public entry.
- `deep-show run` with a `registry` call (#393's scenario), on the canvas core the hub runs.

## The fixture

- **The scene** (`helpers.ts`, `CLEAN`), in #405's scene form, metres with +Y up: a 4 × 0.1 × 4 m floor, its top at
  y = 0.1 m, and a 0.5 m crate resting on it, its centre at y = 0.35 m. **The planted twin** (`TWIN`) is the same scene
  with the crate 0.2 m higher, its bottom at 0.3 m, touching nothing. The audit's check input lets the floor float (it is
  the scene's ground) and nothing else, so the twin's crate is held by nothing: `geometry.floating`, naming `crate`.
  Checked once at the base on the canvas core itself (`deep-show run`, a scratch scenario not kept, with the scene as a
  world-file claim's deliverable): geometry.audit PASS on the scene, FAIL on the twin with `{code: geometry.floating,
  ids: [crate], what: "nothing holds crate"}`, and logic.determinism BLOCKED with `{code: module_missing, kind:
  logic.determinism, module: logic}`.
- **The repo**: #322's world (a git repo with one base commit), its spec replaced by one document check entry, `scene-audit`
  (geometry.audit on doc `01JB1723D00000000000000001`), or for AC3 `scene-determinism` (logic.determinism, `{at_times:
  ["0s"], compare: "same_machine"}`, on the same doc).
- **The task**: the prompt "draw the release scene and save it as scene/release.json", whose handed definition is one
  requirement, R1 "The release scene is saved as scene/release.json", judged by a drafted check
  (`.deepbuild/checks/scene-saved.sh`, a node:test file the hermetic runner counts) that fails on the base, where no scene
  file is saved, and passes once the session saves it. The definition's deliverable is that file.
- **The turn**: the session types the prompt; once the definition locks, it shows the scene through `deep_show`
  (revision 1), writes `scene/release.json` and stops, which makes the claim.

## Criterion to tests

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| A claim whose spec names `geometry.audit` on a deliverable document gets a run in the record whose outcome is the canvas core's for that revision. A planted twin with an item floating 0.2 m above the floor makes the run fail and the verdict FAIL, naming the item. On the merge base the spec entry has no `run` line and is dropped, and the test fails, naming the check. | `#1723.8ec20125` | `ac1.test.ts` (2): the control, the crate resting: the claim has a run of `scene-audit`, finished, `passed`. The planted twin, the crate 0.2 m up: the run `failed`, its evidence names `crate` with `geometry.floating`, and the claim's verdict is FAIL naming `crate` | the base, where `checksOf` drops the entry and the claim passes on R1 alone (both fail naming `scene-audit`); a hub that runs the check on a revision other than the claim's, or records no issues as evidence, or passes the claim over a failed run |
| A patch that makes a new revision after a PASS makes that verdict stale, and `deep_run` runs the check again on the new revision. | `#1723.ee7e66b6` | `ac2.test.ts` (1): after the scene's PASS, the session's next deep_show of the document makes revision 2 (the twin), recorded as `doc.patched`; the record gains `verdict.stale` naming the PASS; `deep_run scene-audit` runs it for the claim, and the run fails with evidence naming `crate`, as revision 2's audit does and revision 1's doesn't | the base (no `verdict.stale` on a patch; deep_run refuses a name the spec "doesn't name"); a hub that keys the verdict by doc ID or commit alone; a deep_run that runs the claim's old revision |
| `logic.determinism` named in a build without `logic` reads BLOCKED with `module_missing`, never PASS. | `#1723.ee326673` | `ac3.test.ts` (1): in a hub whose canvas core's registry lists no `logic`, the spec's `scene-determinism` names logic.determinism: no verdict on the claim is PASS, the verdict is BLOCKED, and it or the check's run names `module_missing` | the base, where the entry is dropped and the claim passes; a hub that skips an unknown kind, or reads it INCONCLUSIVE or as a failure |
| `deep show --check` reads its result from the recorded runs; a presented document with no run never reads PASS. | `#1723.bfd5e63a` | `ac4.test.ts` (1): `deep show --check` of the resting scene as a doc no spec names, before any claim, is presented and doesn't read PASS; after the twin's claim, whose run of `scene-audit` failed, `deep show --check --claim <claim>` of the twin reads FAIL | the base's `Hub::verdict` (PASS with no claim, INVALID for a claim outside the world file); a `result` from the show's own issues, which never run the geometry audit; a constant that never reads PASS |

## Scope the criteria don't cover

- A document check named by a **definition** rather than the spec (the Scope's "spec or definition"): the criteria name
  the spec, and a definition's drafted check file is #1537's document route.
- The core's other kinds through the hub (`document.layout`, `film.audit` and the rest), `logic.budget` and the net
  kinds, an item of a kind the build doesn't know (#403's AC2), and a code the catalog doesn't list.
- Codex sessions, `deep_run` with a claim other than the newest, and the app drawing anything.
- That the run's outcome equals the canvas core's own verdict for that revision is held by the issue's expected values
  (the resting crate passes, the floating one fails naming it), not by a second run of `deep-show` beside the hub.

## Disputes and assumptions a redraft may revisit

- **The entry's keys** (`kind`, `doc`, `input`) are this suite's choice; the issue says only "a kind from
  `check.kind.doc@1`, its input, and the deliverable document by doc ID".
- **The deliverable.** The spec entry's `doc` is what names the document as the work. The handed definition doesn't list
  the doc ID among its deliverables: the base's validity gate reads every deliverable as a file in the checkout, and a
  doc ID isn't one. Its deliverable is the saved scene file.
- **The claim's revision** is the document's current revision when the claim is made, the one the session's deep_show
  presented last.
- **"The verdict FAIL"** is the claim's last `verdict.made` on the twin; R1 passes there, so the FAIL is the document
  check's. "Naming the item" is the verdict's data holding `crate` as a word (the prompt and R1 say nothing of a crate).
- **"Stale"** is the record's `verdict.stale` naming the PASS, the event a new commit makes; `deep_run`'s run is told to
  be on the new revision by its outcome (revision 2 fails where revision 1 passed), not by a field naming the revision.
  The patch is the session's own (#403's AC1 tried three writers; one is enough here).
- **"A patch"** is the agent's next whole revision of its document, which the record writes as `doc.patched` (the hub's
  event for every change of a document). #96's patch ops (`{patch, doc, base, reason, ops}`) apply only to a shared
  document: on the base the canvas core refuses them on an agent's own document with `ref_unresolved`, "no shared
  document has this ID" (seen in the scratch scenario above), and the deliverable here is the agent's own. A redraft
  that wants patch ops would mint the document as a shared one through #806's world file (`DEEP_HUB_TEST_SHOW`).
- **AC4's FAIL** presents the same content again: whether the hub reads the claim's run by the revision's hash or runs the
  claim's check on the presented revision and reads that, the run's outcome is FAIL. A hub that keys runs by revision
  number and runs nothing would read "no run" and fails the test.
- **"A presented document with no run"** is a doc no spec names, before any claim, with no `--claim`: the base's exact
  wrong case. Its `result` may be any string but `PASS`.
- **AC3** asserts BLOCKED on the claim's verdict, and `module_missing` in the verdict or the check's run; whether the run
  is recorded with outcome `missing` is left to the implementer.

## Files

- `helpers.ts`: criterion IDs, the scene and its twin, the spec entries, the handed definition, the world and the
  session (hooks through deep-hook, its own `deep mcp` and `deep show`), the claim's steps, the record and evidence
  readers.
- `fixtures/agent.mjs`: the session's process: parent of its deep-hook runs, its `deep mcp` and its shell commands.
- `ac1.test.ts`, `ac2.test.ts`, `ac3.test.ts`, `ac4.test.ts`: one per criterion.
- `criteria.json`: `[{n, id, text}]`, each ID as `scripts/proof-change.mjs` computes it from the issue's `- [ ]` lines.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.
