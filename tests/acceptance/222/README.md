# Acceptance tests for #222: cue lists, plays and waits written in order, compiled at check into channels and markers

Written first, blind, from issue #222 (its Scope, its Fields, its 8 acceptance criteria and its Proof line: "A 40-cue
explainer, its frames compared at shared times with stored goldens rendered once outside the repo"), the design
sections it links and those they lean on, and base commit `f6d811c7` ("Merge pull request #2392 …"), by a job that
never saw an implementation; none existed, and no other worktree, branch, PR, stash or session was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one test per criterion, plus the planted wrong programs and entries the issue names (the planted
expander of criterion 1; each verb's planted twin, criterion 3; the kit's three planted entries, criterion 4). The
Oracle page's upstream tests are ported in `tests/acceptance/222-oracle/`.

## What was read

- Issue #222, live, no comments; its Oracle page (`doneright/oracles/issues/222.md`, branch `doneright` of the
  Oracle repository): upstream tests for criteria 1, 2 and 3, none for 4 to 8.
- `docs/canvas-primitives.md`: Cue list `cues@1` (every field, the semantics, the cue kit and its planted entries, the
  cost, "It can never"); Registry and seal: registries (entries, origins, kits, planted entries, `<pack>.<name>`);
  Registries and closed lists (the Cue verbs row); Pack, Pack: kinds in any pack, Recipe (step ops, `cue` among
  them); Pack: explain@1 film recipes; Channel and key (`pulse`, eases, "a pulse … is exactly 0 at both ends");
  Channel and key: table eases; Marker; Clip and Placement (stagger: "a total of d × ((n − 1) × lag + 1)"); Film
  layout; Tempo map and cue alignment.
- `docs/technical-design.md`: Films and figures on the canvas (the cue list paragraph), the canvas module table's motion
  row, Canvas modules.
- At the base: `crates/deep-show` (`deep-show run`; `deep show` with `include`, its reply's `expansions` and
  `timing`; `eval` with `paths` and `nodes`; `install_pack`, `packs`, `registries`, `schedule`, `verdict`; scenario
  `packs`, `claims`, `planted`), `crates/deep-canvas-motion` (`doc.rs`: channel targets such as `items/<id>/at/rot/2`,
  `{"ease": {"name", "params"}}` interps, `pulse` modifiers; `module.rs`: motion implements `motion@1`; `cue.rs` is
  #491's cue alignment, unrelated), `crates/deep-canvas/src/document/packs.rs` (recipes, `Expansion`),
  `crates/deep-canvas/src/ease.rs` (the named eases), `packs/` (first-party packs, `deepbuild/<name>`); the merged
  suites `494/`, `408/` (and its `machines.test.ts`), `412/`, `200/`, `185/`, `505-oracle/`;
  `scripts/proof-change.mjs` (criterion IDs) and `scripts/benchmark.mjs` (`judgeLimit`). Code was read to learn the
  surface; every expected value comes from the issue and the design.

## Run them

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/222 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/222/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/222/node_modules/.vite
```

Each file builds `deep-show` once, in `beforeAll` (`cargo build --locked --bin deep-show --no-default-features
--features full`, `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`), copies the
binary out, and fails every test whose build failed; `budgets.test.ts` also builds `--release`, only on a machine that
can judge a timing. The files build cargo binaries and one times a check, so they run one at a time: the implementer
adds to `scripts/lanes.mjs` (this job writes only this folder):

```js
alone.push('tests/acceptance/222/', 'tests/acceptance/222-oracle/');
timed.push('tests/acceptance/222/budgets.test.ts');
```

Every `it` passes a long timeout (60 min; 4× for the budget). Temporary folders are deleted. Node built-ins and vitest
only, plus `scripts/benchmark.mjs`'s `judgeLimit` and `fingerprint`, imported. A test that can't decide here fails with
a message starting `INCONCLUSIVE:`, never passing.

## The surface under test

`deep-show run` as #393, #200, #185, #403, #408 and #1918 left it: one scenario line in, one answer line out; `deep
show` of a whole document from your shell with `include`; `eval {doc, t, paths}` (`values`, `nodes`); `install_pack`,
`packs`, `registries`, `schedule`; scenario `packs`, `claims`, `planted`; `verdict`. **Every name below that neither
the issue nor the design gives is this job's choice, marked *(chosen)***; the implementer builds exactly these, or a
dispute goes to a blind redraft.

### Documents

Films (`profile: film`, 640 × 360 u, `transport.span`) as your shell sends them (no `id`, no `layers`), squares as
`rect@1` 40 u boxes centred on `at.pos`. A film using a first-party verb names `packs: ["deepbuild/verbs@1.0.0"]`.

- **The cue list** is an item of kind `cues@1` (the issue: "A `cues@1` item") whose `params.cues` is the issue's list:
  `{id, when, gap, span, ease, lag, order, targets, set, kind, params}`. The tests name it `list`.
- **`when`**: `"after"`, `"with"`, or `{"at": time}` *(chosen form for `at: time`)*.
- **`set`**: `{path → value}`, each path a field under each target, the suffix a channel's `items/<target>/…` takes
  (`at/pos`, `at/pos/0`, `at/pos/1`, `at/rot/2`, `at/scale`, `adjust/opacity`) *(chosen)*. A cue with `set` and no
  `kind` moves each target's path from its from-value to the value over the cue's window on the cue's ease.
- **A pulse in `set`** *(chosen)*: `{path: {"pulse": {"amount": value of the path's type, "shape"?}}}` writes a
  pulse (Channel and key) on that path over the cue's window instead of a move, so it adds (criterion 5's "a
  `pulse` on the same path").
- **`ease`**: an `ease@1` name as a string, such as `"smoothstep"` *(chosen form)*; unset, sigmoid(10). **`lag`**: a
  number is the ratio. **`span`**: a time literal. **Verb params** (`move_along`'s `path`) under the cue's `params`.
- A hand-written channel: `{target, type, keys: {k0: {t, value, interp: {"ease": {"name": "sigmoid", "params": 10}}}}}`,
  as the base reads it.

### The first-party verbs

A first-party pack *(chosen name and folder)*: `packs/verbs-1.0.0/`, ID `deepbuild/verbs`, version 1.0.0, offered to
each scenario as `packs: [{"id": "deepbuild/verbs", "dir": <checkout>/packs/verbs-1.0.0}]` and named by documents as
`deepbuild/verbs@1.0.0`. Its `cue.kind@1` entries are the issue's verbs, bare-named, less `warp` (#223) and `type`
(#168): enter `create write draw_then_fill fade_in grow spin_in spiral_in by_letter by_word in_turn`; exit `uncreate
unwrite fade_out shrink`; emphasis `indicate flash circumscribe passing_flash wiggle blink focus broadcast`; move
`move_along rotate swap cycle`; change `morph match count_to` (29).

### Fixtures *(chosen)*

`packs/verbs-1.0.0/fixtures/<verb>.json`, one per verb: `{"verb", "document", "reference", "paths"}`. `document` is a
film (as above) whose one cue list, `list`, holds a cue of kind `<verb>`; `reference` is the same film written by hand,
holding no `cues@1` item (channels, markers and plain items in place of the expansion); `paths` lists the item paths
compared (`items/<id>/<field…>`), which must include every path the verb's cue writes (its expansion's channel
targets, derived items' included, so the reference holds items of the derived IDs). The reference must change over
the cue's window. The verb's motion is the fixture's statement; the Oracle lane and the Proof line hold it to the
upstream references.

### The expansion: `deep show`'s `expansions` *(chosen additions)*

The reply's `expansions` (#420's list of recipe expansions, `{instance, kind, pack, key, derived, seeds, broken_out,
channels}`) holds one entry per `cues@1` item: `instance` the cue list's ID, `kind: "cues@1"`, and

- `channels`: `{"<list>.<cue>[.<k>]": channel}`, every channel the expansion writes, each as motion reads a channel
  (`target`, `type`, `keys` with their `t`, `modifiers` with each `pulse`'s `at` and `span`); the channel's ID names
  the cue that wrote it *(chosen)*. Times are integer flicks or `"<decimal>s"`; the tests read both, exactly.
- `markers`: `{"cues.<id>": {"t", "span"}}`, the marker each cue writes (its start and its window: a staggered cue's
  span is d × ((n − 1) × lag + 1)) *(chosen field)*.
- `derived`: the derived items it makes, by ID.

With `include: ["timing"]` the reply's `timing` (the base's `{check_ms, …}`) gains `expand_ms: {"<list>": ms}`, the
expander's own wall time on that cue list at check *(chosen)*.

### The evaluated-data hash *(chosen)*

`{"call": "eval", "doc", "t", "data_hash": true}` adds `data_hash`, a hex digest of the frame's evaluated data at t:
what each drawn item evaluates to (its world transform, opacity, bounds, and the strokes, fills and glyph boxes it
draws), by item ID, and nothing about how a value was made (document fields, channels, cues, keys, markers) or about an
item that draws nothing (a cue list, a camera); a value written at its default hashes as unwritten. Two documents
whose items evaluate the same at t give equal hashes.

### Registries, the cue kit, the schedule

- `registries` (#200's `deep://registries` row): `cue.kind@1` with `owner: "motion"`, its `entries` (each `{name,
  origin, kit: {verdict, rules: [{rule, verdict, message}]}}`; the first-party verbs `origin: "first_party"`, a pack's
  `origin: "pack"`) and its `planted` (`[{name, value, result: KitResult}]`).
- **The cue kit's rules** *(chosen IDs)*, one per clause of the issue: `same_bytes` (expands to identical bytes
  twice), `targets_only` (writes only paths under its targets and its own derived items), `inside_span` (every key in
  [start, start + d × ((n − 1) × lag + 1)]), `end_state` (an enter verb ends fully drawn, an exit verb at opacity 0 or
  unbuilt), `back_to_base` (an emphasis verb leaves every path it wrote at its base value, bit for bit).
- **Its planted entries**: `indicate` (ends at scale 1.0000001, fails `back_to_base`), `fade_in` (last key one flick
  past its span, fails `inside_span`), and `nudge` *(chosen name)*, a verb that writes a non-target's path, failing
  `targets_only`; each failing rule's `message` names the verb.
- `schedule` (#185): `interfaces["motion@1"].digest`, motion's interface digest.

### The test pack *(chosen format)*

`acme/acme@1.0.0`, written by `helpers.ts` into a temporary folder and installed with `install_pack {id: "acme/acme",
dir}`. `pack.json`: `{name: "acme", version: "1.0.0", license, description, requires: {core, modules: {motion}},
recipes: {"acme.stamp@1": "acme.stamp@1.json"}, entries: {"cue.kind@1": [{"name": "acme.stamp", "class":
"emphasis", "recipe": "acme.stamp@1"}]}}` (#200's `entries` form; `class` and `recipe` chosen). The recipe
`acme.stamp@1.json` (Recipe's header and `inputs`) takes the verb's own params as inputs (`amount`, default 0.25) and
has one step, `{"op": "cue", "params": {"set": {"at/scale": {"pulse": {"amount": ["amount", "amount", 0]}}}}}`: a
`cue` step writes one cue over the calling cue's signature (its targets, span, ease, lag, order and from-values), its
params the cue's own fields *(chosen)*. So the stamp swells each target's scale by `amount` at the middle of its window
and is back, bit for bit, at its end.

### Planted programs (the scenario's `planted`) *(chosen names)*

| Name | The wrong program | Criterion |
|---|---|---|
| `cue_with_at_previous_end` | the expander starts a `with` cue at the previous cue's end, not its start; all else as shipped | AC1 |
| `cue_twin:<verb>` | the first-party verb `<verb>` expands as its planted twin (each verb's twin is the implementer's: a wrong curve, timing or end state its fixture must catch) | AC3 |

### Criterion 6: the claim

A stored 1920 × 1080 film (#408's form, `id` and one layer of yours, opened as revision 0) named by one claim of
alpha's whose one requirement is `{"kind": "film.layout"}` at its defaults; `{"call": "verdict", "claim"}` judges it,
and the requirement's row holds film.layout's issues in #408's shape (`code`, `severity`, `text`, `stroke`, `t`,
`ts`, on the issue or in its `actual`).

## Criteria to tests

IDs are `#222.` and the first 8 hex digits of SHA-256 of each criterion's text (`scripts/proof-change.mjs`). Each
test's name starts with `AC<n> <ID>`; each file's header states its fixtures, numbers and wrong programs in full.

| Criterion | File (tests) | What it asserts |
|---|---|---|
| AC1 `#222.88afab32` | `expand.test.ts` (2) | create 1 s; move 3 u `after`; turn 45° `with`; wait 1 s; fade out 0.5 s: the list's start and its cues' ends are exactly 0, 1, 2, 2, 3, 3.5 s in flicks, every key lies on one of them, the move and turn keyed exactly 1 and 2 s; `data_hash` at 2.5 s equals the hand-written channels'. Planted `cue_with_at_previous_end`: `data_hash` at 2.5 s differs |
| AC2 `#222.98d07f32` | `from-values.test.ts` (1) | cue 2 at 3 u, then 4 u, the later `move_along` cue unchanged byte for byte: at its start (3 s, its marker) the square's x is 3, then 4, within 1e-9 |
| AC3 `#222.f801fafc` | `verbs.test.ts` (2) | lag 0.25 × 8 targets × 1 s: the marker and the last key end at 2.75 s within one flick; each of the 29 verbs' films matches its fixture's hand-written film within 1e-6 at 50 seeded whole-flick times in its cue's window, the fixture comparing every path the cue writes; under `cue_twin:<verb>` each verb's comparison finds a difference |
| AC4 `#222.d9fdb65d` | `kit.test.ts` (2) | acme.stamp installs, is listed with origin `pack` and a PASSing kit, expands under its target inside [0, 1] s (scale ≥ 1.2 at 0.5 s, back bit for bit at 1 s); motion@1's digest equal before and after the install; no Rust source names `acme.stamp`; each first-party verb listed `first_party`, its kit PASS on all five rules; each emphasis verb's fixture film reads every path its cue wrote at its end and one flick after exactly as at its start. The planted `indicate`, `fade_in` and `nudge` each FAIL their rule, the message naming the verb |
| AC5 `#222.f1e8b886` | `overlap.test.ts` (1) | `east` (0–1 s) and `north` (`at` 0.5 s, 0.5–1.5 s) both set `at/pos` on `sq`: refused, an error naming both; `north` as a pulse on the same path: presented |
| AC6 `#222.46f1db03` | `layout.test.ts` (1) | a bar the cue list moves through the label `tag` (`down` 0–1 s, `stay` 1–2 s, `up` 2–3 s) beside a hand-written cue marker ending 1.5 s: FAIL, one `layout.crossing` (text `tag`, stroke `bar`), t = 1 s, ts = exactly 1, 1.5, 2 s |
| AC7 `#222.21cc8a35` | `budgets.test.ts` (1) | 512 cues (64 groups × 8 squares): at a frame after the first, every node that ran has its match among the same motion written as channels, none the cue list's; on a reference Mac, `timing.expand_ms.list` over five fresh release processes judged against 10 ms by `judgeLimit`, else INCONCLUSIVE |
| AC8 `#222.3e28e7f1` | `taste.test.ts` (1) | reads the record only; no pictures or no call is INCONCLUSIVE, never PASS (The taste call) |

## Readings where the issue leaves a choice

1. **"Keys at exactly 0, 1, 2, 2, 3 and 3.5 s"** is read as the list's start and its five cues' ends in order (create
   0–1, move 1–2, turn 1–2, wait 2–3, fade 3–3.5), each a `cues.<id>` marker's `t + span`; and every key the
   expansion writes lies on one of those times, each holding at least one key (the wait writes none), with the move's
   and the turn's channels keyed at exactly 1 and 2 s.
2. **"Move it 3 u right"** and **"turn 45°"** are `set` cues (`at/pos` to (3, 0, 0) from the origin, `at/rot/2` to 45),
   not verbs: the issue's verbs list `rotate {angle, about}` but no plain move, and a `set` cue's expansion is one a
   blind test can write by hand. The hand-written document writes the move, the turn and the fade as channels on the
   cues' default ease; create's path build has no form a blind test can write, and at 2.5 s it has ended with the
   square fully drawn, so its channel's absence and its end state hash alike.
3. **"Fails at 2.5 s"**: under the plant the turn runs 2–3 s, so at 2.5 s it is half done and the hash differs.
4. **"The start of a later `move_along` cue"** is the target's position at the cue's start, read by `eval`; the path
   starts elsewhere (x = 10), so a move_along that jumps to its path's start fails. A cue `pause` (a wait) sits between
   so the start isn't the moving cue's own end.
5. **"Ends at 2.75 s within one flick"** is the cue's marker end and its latest key, each within one flick.
6. **"Each verb matches its fixture within 1e-6 at 50 random times"**: the fixture is the hand-written film; times are
   50 whole flicks drawn from the verb's cue's window by a generator seeded with the verb's name, so a run is
   repeatable; every path the cue writes is compared, number by number.
7. **"Each verb's planted twin fails"**: the twin runs in place of the verb (scenario plant) and fails the same
   comparison at the same times; a twin whose film is refused doesn't count as caught, since the criterion's
   failure is the fixture's.
8. **"No canvas-module change"** is behaviour plus one guard: the verb is written by the test at run time into a
   temporary pack, and no Rust source under `crates/` names `acme.stamp`. **"Motion's interface digest unchanged"** is
   deep://schedule's `motion@1` digest read before and after the install in one process.
9. **"Every first-party verb passes the cue kit"** is read from the kit's own result per entry; the emphasis clause is
   also checked independently, bit for bit, on each emphasis verb's fixture film at its cue's end and one flick after.
10. **"Refused naming both"**: `deep show` doesn't present the film, and an error issue names both cue IDs. The cues
    overlap partly (0–1 s and 0.5–1.5 s), so a check that only compares equal windows fails.
11. **"As it does at every other cue end"**: the film also holds a hand-written cue marker, and the crossing's `ts`
    lists its end and the cue list's ends together.
12. **"Costs nothing per frame beyond the channels it writes"** is structural: the nodes that run in a frame after
    the first, against the same motion written as channels. **"Under 10 ms at check"** is the expander's own time,
    judged as #408 judges film.layout's: a reference Mac, five fresh release processes after a warm-up, `judgeLimit`.

## The taste call

The check run writes six files to `docs/evidence/222/` *(chosen names)*: `explainer-cue-01.png`,
`explainer-cue-10.png`, `explainer-cue-20.png`, `explainer-cue-30.png`, `explainer-cue-40.png` (frames of the 40-cue
explainer at the ends of cues 1, 10, 20, 30 and 40, each from the canvas's own frames) and `explainer.apng` (a recording
of the whole explainer). The one call goes in `tests/acceptance/222/TASTE.json`, as #494's:

```json
{ "issue": 222, "criterion": "#222.3e28e7f1", "verdict": "looks_right", "who": "…", "when": "2026-11-13T09:00:00Z",
  "screenshots": { "explainer-cue-01.png": "<sha256>", "…": "…" }, "note": "…" }
```

`verdict` is `looks_right` or `looks_wrong`; `screenshots` names all six with their SHA-256. No test judges a picture.

## Not tested here

- **The Proof line** ("a 40-cue explainer, its frames compared at shared times with stored goldens rendered once outside
  the repo"): goldens rendered outside the repo don't exist at the base; the Oracle lane's graphical case is BLOCKED
  on the same goldens.
- **Scope with no criterion**: `gap`, `order: reverse | seeded`, `at` a marker, collections as targets, placements and
  add placements, derived items' own checks, the verbs' params beyond their defaults, the math@1 names (#233), `warp`
  (#223) and `type` (#168), and "It can never" (run code, loop, reorder silently, read the clock, write a path another
  item's channel owns). They are the implementer's own tests.

## At the base

Not run: at `f6d811c7` nothing of #222 exists (no `cues@1` kind, no `cue.kind@1` registry, no `packs/verbs-1.0.0/`,
no `markers` on an expansion, no `data_hash`, no `timing.expand_ms`, no planted programs of these names), so every test
fails on an assertion; `BASE-FAILURE.txt` says where each fails. The type-check exits 0.
