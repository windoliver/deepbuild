# Acceptance tests for #200, criterion AC11 (blind redraft)

Criterion AC11 of issue #200 ("Registries and the closure rule …"), ID `#200.bd93251c`, verbatim:

> mark@1, builder@1, modifier@1 and check.kind.doc@1 seal in a test build of the core and scene3d with today's marks,
> builders, modifiers and check kinds as the core's entries, every content key unchanged, and each one's kit refuses
> its planted wrong entry, naming the registry and the entry: a mark whose bounds leave out a pixel it draws, a builder
> whose element count isn't computable from its params, a modifier declared deform that adds vertices, and a check
> kind that emits a code the catalogue doesn't list; gpu.output@1's and gpu.function@1's kits refuse theirs the same
> way, an output typed vec3 that its consumer reads as vec4 and a step function declared exact whose body takes a
> float step; and a planted kit that admits any of these makes the seal refuse that registry, naming it, and fails this

Written by a blind redraft job (AGENTS.md, Proof; technical design, Dogfooding) from only: the issue (read live with
`gh issue view 200 --repo windoliver/deepbuild`), `docs/technical-design.md` (Dogfooding; Criteria to tests),
`docs/canvas-primitives.md` (Canvas module; Canvas module: interface and implementation; Registry and seal; Registry
and seal: registries; Registries and closed lists; Builder; Modifier; Mark set), and the code at the base `d722ba3d`
(`origin/main` when written). `tests/acceptance/200/`, other worktrees, other branches and open PRs were not read. The
implementer doesn't edit these files; a dispute goes to a blind redraft, and this is that redraft.

## Run

```sh
npm ci                      # once, if node_modules is missing
CARGO_BUILD_JOBS=6 NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/200-redraft-ac11
node node_modules/typescript/bin/tsc -p tests/acceptance/200-redraft-ac11/tsconfig.json
```

`registries.test.ts` builds, once in `beforeAll`, `cargo build --locked --bin deep-show --no-default-features
--features r2,test-leave-out-effects` in the checkout, honoring `CARGO_TARGET_DIR`, with `CARGO_BUILD_JOBS=6`,
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless the caller sets them, and copies the binary out under the
OS temp folder. The content-key test also needs the merge base's build (`git merge-base HEAD origin/main`): when the
checkout *is* the merge base (HEAD equals it and no tracked file outside this folder differs) the candidate's binary is
that build; otherwise the merge base is exported with `git archive` into `<os temp>/deep-200r11-base/<sha12>/`, kept
per commit so later runs build warm, and built there with its own target folder. It builds cargo binaries, so
`scripts/lanes.mjs` needs `'tests/acceptance/200-redraft-ac11/'` on its `alone` list; this job doesn't edit it. Every
`it` passes a 30-minute timeout. Temporary folders (binaries, evidence roots) go under the OS temp folder and are
deleted. Node built-ins and vitest only. `BASE-FAILURE.txt` is the run at the base.

## Surfaces (all the base's, from #200's own earlier work and #393; nothing new is asked of the implementer)

- **The test build of the core and scene3d**: the `deep-show` features `r2,test-leave-out-effects`. A build of only
  the core (text and look) and scene3d doesn't exist: scene3d requires motion (`crates/deep-canvas-scene3d/src/module.rs`),
  so the smallest build set holding scene3d is `r2`, and `test-leave-out-effects` leaves the effects module out, as
  #200's Scope has a build without effects compile every base step. It also holds r1's modules, cells and vector.
- **The seal** runs when `deep-show run` starts; a refused set answers one line `{"ok": false, "code": "seal_refused",
  "reason", "registry", "entries", "rules", "what", …}` and exits non-zero.
- **`deep://registries/<core version>`**: the `{"call": "registries"}` reply's `registries` rows, each registry
  `{kind: "registry", name, owner, kit, planted: [{name, value, result}], entries: [{name, origin, module, since,
  digest, kit}], …}`, a kit result being `{verdict, entry, rules: [{rule, verdict, message, why}]}`.
- **The planted kit that admits every entry**: the startup argument `--planted kit_admits_all:<registry>` (#200's,
  used on main by #221's and #443's suites).
- **Content keys**: `eval` nodes' `key` (`{"call": "eval", doc, t}` after `deep show` presents the document), over the
  fixtures of the build's `manifest` (#138), as `tests/acceptance/490-redraft-2/` reads them.

## What the tests assert

`registries.test.ts`, each `it` named with the condition it carries:

1. **(seal, today)** The test build seals and deep://registries lists `mark@1`, `builder@1`, `modifier@1` and
   `check.kind.doc@1`, each with `owner: "core"`, each holding every one of today's values (below) as an entry with
   `origin: "first_party"`, `module: "core"` (filled by the core: "as the core's entries"), a non-empty `since` and
   `digest`, and a kit result `PASS`. Extra entries are allowed.
2. **(keys)** Every fixture in the merge base's manifest for this build, evaluated at 0 s, 0.5 s and 1.5 s, gives in
   the candidate's build every `eval` node (`operator|item`) with the merge base's content key, and the same refusal
   code where eval refuses; a fixture missing from the candidate's manifest fails. The comparison is first shown able to
   fail: one node's key altered by hand is caught, naming the fixture and the node.
3. **(planted)** For each of the six registries, the listing's planted entries hold the one the criterion describes
   (below), and its kit result is `FAIL`, with `entry` its name and at least one failing rule with a message, listed
   under the registry's row: the kit's refusal names the registry and the entry.
4. **(admits)**, one `it` per registry (mark@1, builder@1, modifier@1, check.kind.doc@1, gpu.output@1,
   gpu.function@1): with `--planted kit_admits_all:<registry>` the startup is refused, its `registry` is that registry
   and its `entries` (or `what`) name the planted entry test 3 found; and **"fails this"**: test 3's kit check, run on
   that build, reports failures, each naming the registry.

## Choices, with reasons

- **Today's lists** are the base's, read from its code, since "today's" can only mean what ships before the change:
  - marks: the `mark.*@1` kinds scene3d registers: `mark.box@1`, `mark.cylinder@1`, `mark.line@1`, `mark.point@1`,
    `mark.sphere@1`, `mark.text@1`. The 2D kinds and a mark set's `mark` values aren't asserted: the registry table
    has marks2d and data fill those, which the criterion's "as the core's entries" doesn't cover;
  - builders: `builders::KINDS` (`crates/deep-canvas-scene3d/src/builders.rs`): `hull@1`, `slab@1`, `lathe@1`,
    `extrude@1`, `tube@1`, `ball@1`, `coil@1`, `plate@1`, `display@1` (`surface`, which the design lists, isn't a
    builder kind at the base; the building module's builders are only in `full`);
  - modifiers: `stack::KINDS` (`crates/deep-canvas-scene3d/src/stack.rs`), the 18 kinds a builder's stack runs,
    `mod.array@1` … `mod.boil@1`;
  - check kinds: the core's own, `CORE_CHECK_KINDS` (`crates/deep-canvas/src/registry/mod.rs`), 11 kinds from
    `document.validate` to `kind_rules`, matched bare or as `<name>@<n>`.
- **"As the core's entries"** is read as each entry filled by the core (`module: "core"`), as #200's Scope has these
  registries "opened … from the lists the canvas core ships", a list's values becoming its first entries.
- **Recognising a planted entry.** The issue names no planted entry's name or value shape, so the one the criterion
  describes is found by the criterion's own words in the planted entry's name and its failing rules' `rule`, `message`
  and `why` (and, for gpu.output@1, its value's types), every pattern matching: mark@1 `bound` with one of
  `leave/left out/outside/miss/beyond/exceed`; builder@1 `count|element`, `param` and a negation; modifier@1 `deform`
  and `vert`; check.kind.doc@1 `code` and `catalog`; gpu.output@1 `vec3` and `vec4`; gpu.function@1 `exact` and
  `float`. A kit's rules fail "with that rule's message" (Registry and seal: registries), so the words are where the
  design puts them; no exact wording is required.
- **"Fails this"** is this suite's kit check (test 3's) failing on the planted build, with each failure naming the
  registry, beside the seal's own refusal.
- **Content keys against the merge base**, as #490's redraft does: the build before the change is what "unchanged" is
  measured against. Pixels, goldens and corpus files aren't compared; the criterion names content keys only.

## Not covered here

Every other criterion of #200, including AC10's op table, shadow and object-ID passes, and whether the 2D marks of
marks2d and data are mark@1 entries (see Choices).

## At the base

`BASE-FAILURE.txt` is the run at `d722ba3d` on the Linux dev machine: exit 1, 8 passed, 1 failed.

- Test 1 **(seal, today)** fails for the expected reason: the build seals and lists the four registries, each the
  core's, but `builder@1` holds no entry (none of today's 9 builders) and `modifier@1` holds 3 of today's 18
  modifiers (`mod.array@1`, `mod.mirror@1`, `mod.subdivide@1`). Today's 6 marks and 11 check kinds are there.
- Test 2 **(keys)** passes: at the base the checkout is the merge base, so the comparison is against the same build,
  after the in-test check that a hand-altered key is caught. This is behavior that must not change.
- Test 3 **(planted)** and the six **(admits)** tests pass: the base already declares these registries with the
  planted entries the criterion describes (`bounds_miss_pixel`, `count_not_from_params`, `deform_adds_vertices`,
  `uncatalogued_code`, `vec3_read_as_vec4`, `exact_takes_float_step`), each refused by its kit, and
  `--planted kit_admits_all:<registry>` makes the seal refuse each registry with `kit_admits_planted`, naming it and
  the entry. They guard that behavior.
