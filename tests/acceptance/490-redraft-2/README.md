# Acceptance tests for #490, criterion 2 (blind redraft): the comparison half

Criterion 2 of issue #490 ("The closed function list: interval forms, function tables, math functions and ease@1 in
the core"), verbatim:

> Opening the eases as ease@1 leaves every content key, golden and corpus snapshot of the shipped fixtures byte for
> byte the same, and deep://registries lists ease@1 with since, digest, fill, each entry's origin and its kit result;
> a planted opening that renumbers the entries changes the key of a channel keyed with in_out_cubic and fails, naming
> the ease and the item

This folder holds the **comparison half**: the content keys, goldens and corpus snapshots of the shipped fixtures
against the merge base, and the planted renumbering failing. The listing half (deep://registries listing `ease@1`
with `since`, `digest`, `fill`, each entry's origin and kit result) is another job's and isn't asserted here beyond
the precondition below.

Written by a blind redraft job (AGENTS.md, Proof; technical design, Dogfooding) from only: the issue (read live with
`gh issue view 490 --repo windoliver/deepbuild`), `docs/canvas-primitives.md` (Registry and seal: registries;
Registries and closed lists, the Eases row; Channel and key and Channel and key: table eases; The closed function
list), `docs/technical-design.md` (the canvas core), and the base's code at `14bd355e` (a descendant of `69803b94`;
`origin/main` when written). No implementation existed; no other worktree, branch or `tests/acceptance/490/` was
read. The implementer doesn't edit these files; a dispute goes to a blind redraft.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/490-redraft-2
node node_modules/typescript/bin/tsc -p tests/acceptance/490-redraft-2/tsconfig.json
```

The file builds, once in `beforeAll`, `cargo build --locked --bin deep-show --no-default-features --features full`
and `… --features full,test-ease-renumbered` in the checkout (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0`
and `CARGO_PROFILE_DEV_DEBUG=0` unless set), copying each binary out under its own name; a test using a build that
failed fails with cargo's error. After the candidate's precondition holds, it exports the merge base (`git merge-base
HEAD origin/main`) with `git archive` into `target/acceptance-490-redraft-2-base/<sha12>/` (git-ignored, kept so later
runs build warm) and builds its `full` there with its own target folder, as `tests/acceptance/200/` does. It builds
cargo binaries, so `scripts/lanes.mjs` needs `'tests/acceptance/490-redraft-2/'` on its `alone` list; the implementer
makes that edit. Every `it` passes a 30-minute timeout. Temporary folders (binaries, evidence roots, golden stores,
corpora) go under the OS temp folder and are deleted. Node built-ins and vitest only. `BASE-FAILURE.txt` is the run at
the base.

## Obligations on the implementer (names this job chose)

- **`ease@1` in `deep-show run`'s `registries` call** (#200's surface, unchanged): a row `{"kind": "registry",
  "name": "ease@1", "owner": "core", "entries": [...]}` whose entries include `in_out_cubic` with `origin:
  "first_party"`, in the `full` build and in the planted build. This is only the precondition that keeps the
  comparison from passing on a build that opened nothing; the listing's other fields are the listing half's.
- **The Cargo feature `test-ease-renumbered`** of `crates/deep-show` (never in a shipped build): the `full` build with
  ease@1 opened by a planted opening that renumbers its first entries (the core's named eases get other numbers than
  the closed list gave them), so a channel keyed with `in_out_cubic` gets another content key. Concretely the
  `motion.channels` node of the item that channel drives (`eased-box` in `fixtures/eased.json`) must answer another
  `key` in `eval` than the merge base's, at one of the sampled times at least. Nothing else about it is prescribed.
- Nothing else is new: `manifest`, `fixtures`, `deep show` (with `include: ["issues", "pixels"]`, `size`, `t`),
  `eval` (`t`), `golden` (`fixture`, `backend`), `corpus_record`, the scenario's `goldens` and `record` fields are the
  base's (#393, #138, #200), unchanged.

## What the tests assert

`opening.test.ts`, three tests, each named for the criterion:

1. **The opening keeps everything.** The `full` build lists `ease@1` (precondition). Then for every shipped fixture
   (below) and for `fixtures/eased.json`, the candidate's `full` build gives exactly what the merge base's `full` build
   gives:
   - **goldens**: the `golden` reply on `vello_cpu` and on `gpu` (its `verdict`, `reason`, `digest`, `probe`,
     `environment`, `fingerprint`), every run pointed at an empty scratch golden store, so a store the implementer
     commits can't change a verdict;
   - **presentations and their snapshots**: `deep show` at 0 s, 0.5 s and 1.5 s, its `outcome`, `reason`, `code`, its
     issues and notices (each `code`, `severity`, `path`, `ids`) and every snapshot's `sha256`;
   - **content keys**: every `eval` node (`operator|item`) at those times keeps its `key` and the bytes it wrote
     (`result`), and an eval the base refused is refused with the same code;
   - **corpus snapshots**: the `corpus_record` file at those times: the saved `document`, `times` and `accepted`, every
     `snapshots` digest and every item's `values` at each time.
   Each fixture's document must also be unchanged.
2. **The planted renumbering fails.** `full,test-ease-renumbered` lists `ease@1` too, and the same check against the
   merge base fails, with a failure naming `in_out_cubic`, `item eased-box` and a changed content key.
3. **What only a GPU draws.** On a machine where the merge base draws every fixture (`deep show` presents them, the
   `gpu` golden isn't BLOCKED with reason `probe`), test 1 compared all of it and this passes; elsewhere it skips as
   INCONCLUSIVE naming each presentation and gpu golden that went uncompared. It never passes by skipping.

A failure names the fixture, the time, the node and, for an item a channel drives, `ease <names>: item <id>`: the
eases that item's channel keys name, read from the document.

## Choices, with reasons

- **"The shipped fixtures"** are every fixture in the merge base's shipped build's parity manifest (the `manifest`
  call of `full`, the default feature set): each canvas module's own fixtures (`parity/<module>/…`), the kit's scenes
  and the catalog's framework fixtures (#138). At the base that is 81 fixtures, 12 of them scenes. The manifest is the parity suite's one
  list, the one goldens are recorded against (`golden` takes its names) and the one the migration corpus records
  from, so it is the list "golden" and "corpus snapshot" refer to. Fixtures the candidate adds aren't compared (they
  have no base value); a base fixture missing from the candidate's manifest fails. The gallery's examples
  (`crates/deep-show/gallery`) are examples, not fixtures: no golden or corpus attaches to them, so they're left out.
- **How a fixture is presented.** A document fixture's document is presented as you (`deep show`); a module fixture
  that carries a record (text's `counter` and `status`) is presented with that record as the scenario's `record`, so
  it draws as its module meant. A scene (`profile: scene`) is a scenario of calls the kit runs, not a document: the
  eight scenes holding a `document` have that document presented, evaluated and corpus-recorded; the four kit scenes
  holding only `about` (`clean-rebuild-fuzz`, `patch-fuzz`, `repair-loop`, `agent-decision`) have nothing to present,
  so only their goldens are compared. Every fixture's golden is compared, since `golden` takes the fixture by name.
- **Fixtures the base can't present.** Of the base's 77 documents, on this Linux machine 19 are presented and 55 are refused (the
  catalog's planted framework fixtures, which exist to raise their codes, and the scene documents): their refusal (outcome,
  issues) and the eval's `no_revision` are compared, their golden and corpus file too. The three 3D figures
  `effects/shadowed-box`, `scene3d/figure` and `scene3d/stack` are `not_presented` without a GPU (reason `timeout`):
  their outcome, eval nodes, vello_cpu golden and corpus file are compared, and their GPU snapshot goes to test 3, as does
  every fixture's gpu golden (BLOCKED, reason `probe`, without a GPU); test 3 is INCONCLUSIVE here rather than a pass.
- **"Golden"** is the kit's `golden` reply digest per backend (the parity suite's goldens), and also, as #200's AC5
  read it, the bytes every evaluated node wrote; **"snapshot"** is each `deep show` snapshot's sha256 and each
  corpus file's Vello CPU snapshot digests; **"content key"** is each `eval` node's `key`.
- **The corpus file's `modules`** (the module versions that saved it) is the one field not compared: it records which
  release saved the document, not what the document gives, and a release that opens a registry may version a module
  without changing any key or pixel. Everything the migration part compares (document, values, snapshots per time)
  is compared.
- **A channel keyed with `in_out_cubic`.** No shipped fixture keys an ease (motion's `slide` is linear), so this suite
  adds `fixtures/eased.json`: item `eased-box` driven by channel `eased-x` from a key eased `in_out_cubic`, and item
  `other-box` driven by keys eased `in_cubic` and `out_cubic`, so every named ease motion lands at the base except
  `linear` is in the comparison. Times 0.5 s and 1.5 s fall inside the eased segments. "The key of a channel" is the
  content key of the `motion.channels` node of the item the channel drives, the node a channel's value comes from at
  the base.
- **"Fails, naming the ease and the item"** is this suite's comparison check failing on the planted build, a failure
  naming `in_out_cubic` and `item eased-box`, as #200's AC5 has it.
- **Against the merge base, not a closed-list build.** The issue says no content key, golden or corpus snapshot
  changes; the merge base is the build before the opening, so it is what "the same" is measured against, as #200's
  AC10 and AC11 do.

## Not covered here

The deep://registries listing's fields (`since`, `digest`, `fill`, origins, kit results) and every other criterion of
#490.

## At the base

`BASE-FAILURE.txt`: all three tests fail for the expected reasons. Tests 1 and 3 fail their precondition
(deep://registries lists no `ease@1`); test 2 fails building `full,test-ease-renumbered` (no such feature). To check
the check itself, this job also ran, once and then deleted, a scratch copy with the precondition removed and the
planted build replaced by `full`: the merge base's `full` (exported and built apart) against the checkout's `full`
gave no failure in test 1, and with one `motion.channels|eased-box` key changed by hand the check failed with
`suite/eased.json at 0.5s: ease in_out_cubic: item eased-box: node motion.channels|eased-box's content key changed
…`; test 3 skipped as INCONCLUSIVE on this Linux machine, naming the three 3D figures' presentations and every gpu
golden.

## The owner's decision (2026-11-03)

This redraft replaces the comparisons of `tests/acceptance/490/opening.test.ts` (that README: Disputes). Its
comparison of each presentation's notices was dropped by the owner's decision: criterion 2 names content keys,
goldens and corpus snapshots, and criterion 8 requires the base's false `unknown_kind` notice on drawn kinds to go.
