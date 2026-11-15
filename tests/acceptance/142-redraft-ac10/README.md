# Acceptance test for #142, criterion 10 redrafted: a test pack's grammar rule as a pack kind rule

A blind redraft (design: Dogfooding) of criterion 10's test, `AC10 #142.d708e2b3`:

> A test pack's recipe acme.slides, whose grammar rule of one entrance at a time is a pack kind rule with its planted
> twin, installs with no canvas-module change and refuses a cue list whose two entrances overlap, naming the cue and
> the rule, while its clean twin passes

Written at `1b93a9eb2`: base `64c9be338` ("Merge #223's branch (PR #2505, group warps) as #142's base") plus the first
draft of this suite, `tests/acceptance/142/`, read as data. Written by a job that saw no implementation of #142 and no
other worktree, branch, PR, stash or session. The implementing agent doesn't edit these files (AGENTS.md, Proof).

**It supersedes** `tests/acceptance/142/ac10-pack.test.ts` (its one `it`). The suite's other files stand.

## What was read

- Issue #142, live (`gh issue view 142 --repo windoliver/deepbuild`): its Scope, its Fields and criterion 10.
- `docs/canvas-primitives.md`: Pack: explain@1 film recipes ("A cue list that breaks a rule is refused, naming the cue
  and the rule"); Recipe (`repeat: {count, as}`, `a[i]` and `a.name` into a records input, `len(list)`); Pack; Pack:
  kinds in any pack; Pack: kind rules and the kind kit (rules, planted twins, the kit run at pack check); Pack:
  dependencies (`requires.packs: [name@version]`); Cue list `cues@1` (verbs as `cue.kind@1` entries of packs, "adding
  one changes no canvas module"); Honest numbers (both sections).
- `docs/technical-design.md`: Films and figures on the canvas (any pack adds a verb "with no canvas module's change");
  Dogfooding.
- The first draft: `README.md`, `helpers.ts`, `ac10-pack.test.ts`, `BASE-FAILURE.txt`, `tsconfig.json`.
- At the base, for surfaces and facts only: `crates/deep-canvas/src/document/packs.rs` (the manifest check, recipe
  steps and their `repeat: {count, as}`, `Template` and `Expr` with `len`, `a[i].b` and bare names as text, the rule
  list) and `packs/deps.rs` (`requires.packs` entries read as `name@version`, the name without its owner);
  `crates/deep-canvas/src/document/pack_kinds.rs` (the kind kit: examples and twins valid, the cost at defaults
  within 25% of the declared, `field.effect` failing a field that leaves the frame unchanged, each twin raising its
  rule's code, the kit's store holding the pack and the packs it requires); `crates/deep-canvas/src/document/rules.rs`
  (Honest numbers); `crates/deep-show/src/packs.rs` and `hub.rs` (`install_pack`, `packs`, the `set_digest` every
  reply carries, a refusal on any error); `packs/verbs-1.0.0/` (`fade_in`, class `enter`).

## Run it

```sh
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"   # cargo, where it isn't on PATH
npm ci                                             # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/142-redraft-ac10 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/142-redraft-ac10/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/142-redraft-ac10/node_modules/.vite
```

The file builds `deep-show` once, in `beforeAll` (`cargo build --locked --bin deep-show --no-default-features
--features full`, `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`), copies the
binary out, and fails the test if the build failed. The `it` passes a 60 min timeout. Node built-ins and vitest only;
the test pack is written into a temporary folder that is deleted. Nothing here judges a timing, so no test is
INCONCLUSIVE; a test that couldn't decide would fail, never pass. The folder builds a cargo binary, so
`scripts/lanes.mjs` needs `'tests/acceptance/142-redraft-ac10/'` in its `alone` list (the implementer makes that edit).

## The surface under test

`deep-show run` as the first draft reads it: the scenario's `packs: [{id, dir}]` (here the first-party verbs only);
`registry`; `install_pack {id, dir}` (reply `outcome`, `issues`); `packs` (rows `{pack, version, state, issues}`);
`deep show` of a whole document from your shell. **Every name below that neither the issue nor the design gives is a
choice, marked *(chosen)*; each is the first draft's**, kept as it wrote it, unless the list of differences says so:

- **A rule over a cue list** *(chosen)*: a pack kind rule (`{code, expr, at, fix}`) gains **`over: "<input>"`**, naming
  a `cues@1` input of the kind's recipe. It is evaluated at rest for **each pair of cues** of that list, `cue` and
  `other`, `other` before `cue` in the list's order, after `cues@1` resolves the list's times (no pair for a one-cue
  list). Its expression reads `cue.start` and `cue.end` (seconds from the list's start), `cue.class` (the cue's kind's
  `cue.kind@1` class as text, `wait` for a wait) and the same of `other`; a pair for which it is false raises the rule's
  code as an error naming `cue`'s `id`, and the document is refused.
- **A refusal**: `deep show` doesn't present the document, and an issue of severity `error` names the cue (its `id`)
  and the rule (its code) somewhere in its JSON. Two overlapping entrances are named by the later, slide_two.
- **The test pack** *(chosen)*: `acme/acme@1.0.0`, written by `writeSlides` (helpers.ts) and installed with
  `install_pack {id: "acme/acme", dir}`, the verbs offered in the scenario. Its `pack.json`:
  `requires: {core, modules: {motion, marks2d}, packs: ["verbs@1.0.0"]}`; `recipes: {"acme.slides@1":
  "acme.slides@1.json"}`; `kinds: {"acme.slides@1": {minor: 0, recipe, children: [], capabilities, rules: [{code:
  "acme.one_entrance", over: "cues", at: "rest", expr: "!(cue.class == enter && other.class == enter && other.start <
  cue.end && cue.start < other.end)", fix}], twins: [{example: <overlap.json's sha256>, expect: "acme.one_entrance"}],
  migrate: {}, examples: [<clean.json's sha256>], cost: {class: "figure", at_defaults: {cpu_ms: 0.5, gpu_ms: 0.2,
  items: 8}}}}`; `assets`: the two examples. The recipe `acme.slides@1.json` takes one input, `cues` (records, default
  `[]`), and has one step: `title: {op: "mark", kind: "text@1", repeat: {count: "len(cues)", as: "i"}, params: {text:
  "cues[i].text", font: "body", size: 48}, at: {pos: [64, "48 + 64 * i", 0]}}`, a title per cue on its own line.
- **The examples**: films of 640 × 360 u, 2 s, naming `acme/acme@1.0.0` and `deepbuild/verbs@1.0.0`, each holding one
  instance `deck` of `acme.slides@1`. The clean one: slide_one `fade_in` NORTH over 0.5 s, then slide_two `fade_in`
  SOUTH over 0.5 s (`after`). The planted twin: the same with slide_two `with` slide_one, so the two entrances overlap
  over 0–0.5 s.

## What the test asserts

One process: `registry`, `install_pack`, `packs`, `registry`, then the twin and the clean example presented.

| # | Assertion | The wrong program it fails on |
|---|---|---|
| 1 | `install_pack` answers `installed` with no error, and acme's `packs` row reads `installed` with no error: its kind kit ran, the clean example passing the rule and the twin failing it | the base (a kind rule can't read a cue list, so acme is refused); a kit that refuses a rule over cues |
| 2 | The module-set digest (`set_digest`) is the same on the `registry` replies before and after the install, and no Rust source under `crates/` outside tests names `acme.slides` or `acme.one_entrance` | a rule over cues, or the test pack's kind, compiled into a canvas module |
| 3 | The twin is refused: not presented, and an error names slide_two and acme.one_entrance | a rule that only warns and presents (the base's kind rules are warnings); a refusal naming no cue; a rule that misses an overlap |
| 4 | The clean twin is presented with no error | a check that refuses entrances in turn |

## Readings where the issue leaves a choice

1. **"Installs with no canvas-module change"**: the pack is written at test time, installed into a running build, and
   checked there; the module-set digest doesn't change and no canvas module names it.
2. **"Refuses … naming the cue and the rule"** is an error issue whose JSON holds both, as #222 reads its refusals.
   **"The cue"** of two overlapping entrances is the later one, slide_two; an error that also names slide_one still
   names it.
3. **"Its clean twin passes"**: the clean example, presented with no error.
4. **"With its planted twin"**: the kind's `twins` entry; the install proves the kit ran it, and the test also presents
   it as a film.

## Differences from the first draft

Same criterion, same calls, same rule form, same refusal reading; the test pack changes where the base would refuse it
for reasons the criterion doesn't name:

- The titles are NORTH and SOUTH, not ONE and TWO: the base's Honest numbers check refuses a shown number word with
  `number_unsourced`, which would fail the kit's clean example (so the install) and the clean twin.
- `requires.packs` names the verbs `verbs@1.0.0`, the design's `name@version`; the base reads the name without its
  owner and refuses `deepbuild/verbs@1.0.0` there as not `name@version`. The kit checks the examples in a store of the
  pack and the packs it requires, so the requirement is what lets `fade_in`'s class resolve there.
- The recipe takes only `cues`: the first draft's `stage` input changed nothing the recipe draws, and the kind kit's
  `field.effect` part fails a field that leaves the frame unchanged at every value tried.
- The step repeats `{count: "len(cues)", as: "i"}` and reads `cues[i].text`, which the base's recipes already take,
  in place of `{over: "cues", as: "c"}` and `c.text`, a step repeat the base refuses ("over, on and pack land later")
  and the issue's scope doesn't add. Each title has its own line (`48 + 64 * i`).
- The test also requires no error on the `install_pack` reply itself.

## At the base

Not run (no `deep-show` build). Read from the base's code: the test builds the binary and then fails at
"acme/acme@1.0.0 installs": the base's rule reader takes only expressions over the recipe's inputs, and this one reads
`cue.class`, `cue.start` and `other.end`, so the pack check refuses acme. The type-check exits 0.
