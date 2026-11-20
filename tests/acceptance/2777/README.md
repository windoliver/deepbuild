# Acceptance tests for #2777: the closure rule reaches a kind's fields

Written first, from issue #2777 ("The closure rule reaches a kind's fields: every list of words a document can set is a
registry, closed with its reason and what to do instead, or open, read from the sealed listing": its Scope, its Fields,
its eight acceptance criteria and its Proof line), the design sections it links, and base commit `81c6b9c34` ("Merge
pull request #2849 …"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue's body, read live with `gh issue view 2777` (no comments).
- `docs/technical-design.md`: Dogfooding and "Tests written first, by a job that never sees the code".
- `docs/canvas-primitives.md`: Registries and closed lists (the 63-row table); Registry and seal: registries (the
  closure on every list the canvas documents, "The local preflight fails an enum with no closure", `deep_kinds` lists
  every registry); Registry and seal; Item and kind; and the lists the issue names: Camera `camera@1` and its lens;
  Material (`translucency.kind`, `shadow`) and Material: water; Light and the light policy (its closed `kind`); Look
  `look@1`: tone mapping; Emitter; Foley `foley.render@1` and its "As built" note; Modifier (the GPU deforms bob, sway,
  wave and spin).
- `AGENTS.md`.
- At the base, for surfaces and conventions only: `scripts/canvas-closures.mjs` (#200's `closures` and `drift`),
  `packages/contracts/canvas-closures.json`, `packages/contracts/canvas-schemas/kinds.dump@1.json`, `scripts/lanes.mjs`
  (`checks`, the lint lane, `alone`), `scripts/checks.mjs`, `scripts/canvas-skill.mjs` (`dumpKinds`: the listing and
  each structured field's forms), `scripts/proof-change.mjs` (`criterionId`), `crates/deep-canvas/src/form.rs` (the form
  language), `crates/deep-show/src/kinds.rs` (`fields_of`, `declared_forms`, the dump, `kinds --dump`),
  `crates/deep-show/src/main.rs` (`start_args`, `planted_named`, the `seal_refused` line), `crates/deep-show/Cargo.toml`
  (its features), `crates/deep-canvas-test-modules` (#200's `test.mode`), `crates/deep-canvas-scene3d/src/spec.rs`
  (the material's forms), `stack.rs` (the modifier kinds), `emitters.rs`, `crates/deep-canvas-media/src/emitter.rs`,
  `scripts/foley-pack.mjs`; the suites `200` (closest: the closure rule, scratch trees for `--root`, test canvas modules
  behind `test-*` features, the `seal_refused` line), `412` (`deep-show kinds --dump`, `--planted`, the reference-Mac
  gate and judge), `1971` (deep_kinds `op: field`), `1973` (structured fields' forms; the agent's deep_show on a scene)
  and `1970` (what a refusal names).

The criterion IDs are `criterionId`'s (the text after `- [ ] `, trimmed, white space collapsed, the first 8 hex of its
SHA-256): AC1 `#2777.d820cdcc`, AC2 `#2777.45abf58c`, AC3 `#2777.728bbb54`, AC4 `#2777.c186d624`, AC5 `#2777.5fe304dc`,
AC6 `#2777.af753bc6`, AC7 `#2777.71fec45e`, AC8 `#2777.a05e43e4`.

## What the base already does, which these tests don't credit

From the base run (`BASE-FAILURE.txt`) and the base's code:

- `node scripts/canvas-closures.mjs closures` holds the 19 enums of the canvas schemas to the closure rule and `drift`
  holds the 63-row table to `packages/contracts/canvas-closures.json`; the lint lane runs both. Nothing reads a kind's
  fields for closures, and no row anywhere says `instead`. `canvas-closures.mjs fields` answers `BLOCKED closures:
  usage: …` and exits 3.
- The full build's sealed listing (`deep-show kinds --dump`) holds 343 entries in 20 registries; 612 fields of 65
  kinds are typed json, and deep_kinds `op: field` prints the forms each one's reader declares (#1973). By this suite's
  reading of a field list (below) those forms offer 183 field lists: 128 of two or more words, 47 of one word beside
  other forms, 8 of a lone word. The listing has no `field_lists`, and the dump's schema (`kinds.dump@1.json`) allows
  none at its top level.
- The agent's deep_show of a scene whose camera sets `projection: fisheye` is refused with one error, `out_of_range` at
  `items/cam/params/projection`, carrying `actual`, `what`, `fix` and `forms`; it names no list, nothing that would
  reopen it and no `instead`. The same scene with `perspective` is presented with no issue.
- deep_kinds `{op: "closure", …}` is refused with `enum` at `/op` (its ops are list, word, search, read, gallery, sheet,
  step_ceilings, field and bindings). An unknown `--planted` name answers `{"ok":false,"code":"bad_input"}` and exits 2;
  an unknown cargo feature fails the build.
- The emitter's distance models (read from a document's `emitters`), foley's materials and actions (the foley@1 pack
  and a film's `foley_materials`), the GPU deforms (`mod.bob@1`, `mod.sway@1`, `mod.wave@1`, `mod.spin@1`, rows of
  scene3d's closed modifier table; `modifier@1` holds four other entries) and the light kinds (four entries of `kind@1`)
  are no kind's field at the base, so the sealed listing holds none of them as a field list yet. The water material's
  form offers single words only (`wind {…} | […]`, `{…} | none`, `curve ID | field {x, z}`).
- Two quirks of the form language at the base, not this issue's: `blend` reads as a string's name and `u` as a number,
  so `material@1.alpha_mode` offers the words opaque, mask and add, and `arch.stair@1.type` straight, l and spiral.

## Run them

```sh
npm ci                                   # once, for vitest and typescript
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2777 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2777/tsconfig.json
```

Node 24. Each file builds every feature set it lists once, in list order (`cargo build --locked --bin deep-show
--no-default-features --features full[,<test feature>]`) in the checkout's target folder (`CARGO_TARGET_DIR` honored),
with `$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin` first on `PATH`, `RUSTUP_HOME` and `CARGO_HOME` the
user's unless set, and `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set; it clones the binary out under
its own name and fails each test that uses a build that failed. `seal.test.ts` builds the full set with
`test-tone-unclosed` and with `test-tone-closed`, `reading.test.ts` the full set alone and with `test-tone-closed`, and
every other file the full set alone (so the checkout's target folder holds the full build when `preflight.test.ts` runs
the lane). No hub, no `deep mcp` and no built packages. Every temporary folder is deleted after its file, and the only
processes started are each command's own child, waited for, or killed by its PID at its timeout. Node built-ins and vitest only, plus `scripts/lanes.mjs`, which `preflight.test.ts` imports to read the
local preflight's lanes. A run with `--root tests/acceptance/2777` may leave Vitest's cache in
`tests/acceptance/2777/node_modules`; delete it.

`scripts/lanes.mjs` needs `'tests/acceptance/2777/'` in its `alone` list (each file builds `deep-show`, and
`preflight.test.ts` times the lane), as #200's and #412's folders are; this README is the instruction, and the
implementer makes that edit. The closure lane's own command goes into a lane of `checks` (AC8 reads it there).

Each test passes its timeout as the last argument of `it` (3,600,000 ms); the builds run in `beforeAll` (7,200,000 ms),
since a cold build of `deep-show` takes many minutes on a loaded Mac.

Gates: AC8's timing runs only on a reference Mac fit to judge (Mac15,7 or Mac15,12, Low Power Mode off, thermal state
nominal, a 1-minute load at most the core count; mains power never gates); elsewhere, or between the limit and the
margin, it skips as INCONCLUSIVE after the structural and no-network checks; it never passes by skipping. The
no-network leg needs Seatbelt (`/usr/bin/sandbox-exec`, macOS): without it, it skips as INCONCLUSIVE (platform) after the
structural checks. `BASE-FAILURE.txt` is the run at the base.

## The surface under test

`deep-show run` (JSON lines in, one reply per call: the agent's `deep_show` with `include: ["issues"]`, as #1973's
suite drives it, and `deep_kinds`), its startup refusal line and `--planted <name>`, `deep-show kinds --dump <dir>`
(#412), `node scripts/canvas-closures.mjs …` (#200) and the canvas reference's text. **Every name below that the issue
doesn't give is this job's choice** *(chosen)*, the smallest surface consistent with the design and the base; the
implementer builds exactly these, or a dispute goes to a blind redraft.

### What a field list is *(chosen)*

A field list is a place in the form a sealed entry's field declares (the form language, `crates/deep-canvas/src/form.rs`,
as deep_kinds `op: field` prints a field's `forms`, one per alternative) where a document writes a bare word:

- each `|` choice with at least one alternative that is a word or a tagged word (`word {fields}`); its words are those
  alternatives' words, and its other alternatives (a number, a string's name, a flag, an object, a list) sit beside them;
- each word or tagged word that is a whole form on its own.

A word is a name the form language reads as no type (or any name in backticks); the names it reads as a number, a
string or a flag (`m`, `deg`, `EV100`, `ID`, `role`, …) are not words. So `perspective | orthographic | isometric` is a
list of three words, `m | auto` a list of one (`auto`), `{…} | none` a list of one (`none`), and `coc?: physical` a list
of one. Why not only choices of two or more words: the water material's form offers no such choice (its words are
`wind`, `none` and `field`, each beside another form), yet AC3 needs a row for the water material's terms and the
issue rules out opening a list; and "the lens's fields" reads naturally as the lens's lists (`lens.fit`, and
`exposure: EV100 | from_lens`), not one. The issue's "about 700 field lists of bare words" in the reference fits it too.

**A list's name** *(chosen)*: `<entry name@major>.<field>`, then `.<object field>` for each object field it sits in,
`.<word>` for each tagged word whose body it sits in, and `.<slot>` for a tuple slot named with its own form; a list
`[form]`, a map's value `{key → form}`, a bound `≤ n` and a note add nothing. So `camera@1.projection`,
`camera@1.lens.fit`, `material@1.translucency.kind`, `material@1.water.flow.along`, `slab@1.uv0.planar.axis`. At the
base the rule names the 183 lists without a repeat. A field the listing lists beside its object (such as
`plate@1.overlays[].roles`) is a field of its own, with its own lists.

### The sealed listing: `field_lists` *(chosen)*

`deep-show kinds --dump <dir>` writes, beside `registries`, a top-level `field_lists`: one element per field list,

```json
{"list": "camera@1.projection", "entry": "camera@1", "field": "projection",
 "words": ["perspective", "orthographic", "isometric"],
 "closure": {"closed": "<reason>", "reopens_if": "<text>", "instead": "<text> | nothing"}}
```

`closure` is one of `{"registry": "<name@major>"}` (a registry the listing holds), `{"closed": <reason>, "reopens_if":
<text>, "instead": <text> | "nothing"}` or `{"open": "item" | "pack"}`. A reason is one word (`[a-z_]+`); the seven the
rule has are expected, but the issue says only "most" take one of them, so no set is enforced. `words` is the list's
words in the form's order. The listing may hold field lists no kind's form offers (the emitter's distance models,
foley's materials and actions, the GPU deforms and the light kinds, wherever the implementer seals them), under names
of the implementer's choosing. Other keys are allowed. The implementer adds `field_lists` to `kinds.dump@1.json`.

### The seal's refusal (AC1) *(chosen)*

#305's and #200's startup line, before any scenario, exit 2: `{"ok": false, "code": "seal_refused", "reason":
"list_unclosed", "entries": ["<entry name@major>"], "field": "<field>", …}`; `entries` is #200's field, `field` the
field the list sits in. Other fields (`modules`, `registry`, `what`) are the implementer's.

### The closure lane: `node scripts/canvas-closures.mjs fields [--listing <file>] [--base <file>]` *(chosen)*

Holds every field list of the sealed listing to the closure rule. `--listing <file>`: the listing to read (a `kinds
--dump` file); without it, the lane reads the sealed listing of the full `deep-show` built in the checkout's target
folder (`CARGO_TARGET_DIR` honored), by a means the implementer picks, and reads `BLOCKED fields: …` (exit 3) when it
has none. `--base <file>`: the listing before the change, which the reading's "added by this change" compares against;
without it, the change is read against the merge base, by a means the implementer picks, with no network. Its lines:

```text
PASS fields: <n> field lists in the sealed listing, each with a closure: <r> registry, <c> closed, <o> open
FAIL fields: <list>: <why>
NOTE fields: <k> closed lists say instead: nothing: <list>, <list>, …; added by this change: <list>, … | none
```

Exit 0 on PASS, 1 on any FAIL, 3 when blocked. The NOTE line is the reading: one a run, printed on a PASS or a FAIL,
never a verdict (it never changes the exit). `<k>` counts the closed lists whose `instead` is `nothing` and the names
after it are those lists (`none` when there are none); a singular "1 closed list says" reads too.

### The drift lane: `node scripts/canvas-closures.mjs drift [--root <tree>] [--listing <file>]` *(chosen flag)*

As today for the hand-written table, and it holds the generated table to the field lists of the listing (`--listing`,
or the default the lane uses): one row per list, each naming a list of the listing with its words, its closure, its
`reopens_if` and its `instead`. A row the listing doesn't back, a list with no row, or a row whose closure, reason,
reopens_if or instead differs from the listing's fails with `FAIL drift: <list>: <why>`. `drift --root <tree>` reads
only `<tree>/docs/canvas-primitives.md`, `<tree>/packages/contracts` and the listing. #200's suite runs `drift --root
<tree>` with no `--listing` on a clean copy and expects it to pass, and checks that the lint lane runs `closures` and
`drift`; the implementer keeps both true.

### The generated table *(chosen)*

Under `### Registries and closed lists`, after the hand-written table (which stays, its header `| List | Where |
Closure | Why, or its kit |`), a block the generator writes and the drift lane reads:

```text
<!-- field lists: generated from the sealed listing by <the implementer's command>; do not edit -->

| Field list | Words | Closure | Reopens if | Instead |
|---|---|---|---|---|
| `camera@1.projection` | `perspective`, `orthographic`, `isometric` | closed: <reason> | <text> | <text> or nothing |
<!-- /field lists -->
```

One row per field list of the listing. The List cell holds the list's name, the Words cell its words separated by
commas (each in backticks or not), the Closure cell `registry <name@major>`, `closed: <reason>` or `open: <item | pack>`;
Reopens if and Instead hold the closed list's texts (`—` otherwise). A `|` inside a cell is written `\|`.

### The document check's refusal (AC5) *(chosen)*

The issue a value outside a closed field list gets keeps its code and fields (today `out_of_range` at
`items/<id>/params/<field…>`, with `actual`, `what`, `fix`, `forms`) and gains `list` (the list's name), `reopens_if`
and `instead`, each as the listing gives that list.

### deep_kinds on one list (AC6) *(chosen)*

`{"call": "deep_kinds", "op": "closure", "list": "<list>"}` answers the list's element of `field_lists`: `{"list",
"entry", "field", "words", "closure"}`. (#1971's suite holds every `op: field` line under 512 bytes and every one-field
reply under 1 KB, so the closure doesn't ride in a field line.)

### Test canvas module and features of `deep-show` *(chosen)* (none in a shipped build)

| Feature | What the build holds |
|---|---|
| `test-tone-unclosed` | the full set plus module `test.tone`, kind `test.tint@1 {box: [u, u, u, u], tone: warm \| cool \| neutral = warm}` drawn as a rect (as #200's `test.swatch@1`), `tone` declared in the form language with no closure: the seal refuses the set |
| `test-tone-closed` | the same, `tone` closed `{closed: determinism, reopens_if: "a tint needs a tone the three can't give", instead: nothing}`: the set seals, and its listing holds `test.tint@1.tone` |

### Planted startup argument *(chosen)*

`--planted refusal_bad_value_only` on `deep-show run`: the issue for a value outside a closed field list carries only
the bad value (`actual`), with no `list`, `reopens_if` or `instead`; nothing else changes.

## Readings where the issue leaves a choice

- **"Refused at the seal, naming the kind and the field"** (AC1): the startup line above, its `reason` `list_unclosed`,
  `entries` holding `test.tint@1` and `field` `tone`. "Its twin … seals": the startup exits 0 with its `registry` call
  answered, and the twin's listing holds `test.tint@1.tone` with its three words and a closed closure (so the twin is
  what it claims).
- **"On main after the first fill"** (AC2) is the full build of the checkout under test; **"every field list of the
  sealed listing"** is held two ways: the lane passes on the listing's `field_lists`, and those are every list the
  kinds' forms offer, each place found by `op: field`'s forms read with the form language (helpers.ts, `placesOf`) being
  a list of the listing under its name, of its entry and field, with at least its words (more words are allowed, so a
  fix of the two quirks above passes). The listing may hold more. Each list is named once, with a closure of the
  rule's shape. To show the PASS is the lane's own check, the same listing with `camera@1.projection`'s closure taken
  out must fail the lane, naming it.
- **"Their count, the count by closure"** (AC2): the PASS line's `<n>` is the number of the listing's field lists, and
  `<r> registry, <c> closed, <o> open` its counts by the closure's form. **"The closed lists whose instead is
  nothing"**: the reading's names are exactly those lists, and `<k>` their number.
- **"The ten lists … each have a row"** (AC3), read from the reference as committed: a row each for
  `camera@1.projection` (perspective, orthographic, isometric), `material@1.translucency.kind` (thin, wrap),
  `material@1.shadow` (auto, cast, none), `look.finish@1.tone_map` (none, filmic, agx, neutral) and `camera@1.lens.fit`
  (horizontal, vertical, wider), the base's lists of those names, each row offering at least those words; "the water
  material's terms": a row for a list in `material@1.water`; "foley's materials and actions": a row offering the ten
  materials and a row offering the nine actions (the design's lists, which the foley@1 pack's tables match); "an
  emitter's distance models": a row offering inverse, linear and exponential; "GPU deforms": a row offering bob, sway,
  wave and spin; "light kinds": a row offering point, spot, sun and area. A word may carry its module's prefix and its
  major (`light.point@1`, `mod.sway@1`). The last four are matched by their words, since at the base no kind's field
  holds them and the entry they land in is the implementer's.
- **"A planted reference whose generated table drops one list, and one whose row names another reason than the data"**
  (AC4): scratch trees holding a copy of the reference and of `packages/contracts`; the dropped list is
  `camera@1.projection`; the other row is `material@1.translucency.kind`'s, its Closure cell made `closed: <the first of
  the seven reasons that isn't the listing's>`. "The data" is the full build's sealed listing, given by `--listing`.
  The committed reference must pass the same drift run, so the failure is the plant's.
- **"Refused, and the refusal names the list, what would reopen it and instead"** (AC5): the revision's `outcome` is
  `refused`, and an error at `items/cam/params/projection` carries `list` `camera@1.projection` and the listing's
  `reopens_if` and `instead` for it, as equal text. The same scene with `perspective` must pass the document check.
  **"A planted refusal with only the bad value fails, naming the code"**: under the plant the document is still refused
  at that path with `actual` fisheye, and this suite's check fails with a sentence starting with the issue's code.
- **"`deep_kinds` on a closed list"** (AC6): `op: closure` on `camera@1.projection`, and on every closed list of the
  listing, each answering the listing's reason, `reopens_if` and `instead`.
- **"A planted change that adds a closed list with `instead: nothing`"** (AC7) is the `test-tone-closed` build, whose
  listing holds `test.tint@1.tone` closed with instead nothing beside the full set's lists. **"Shows in the lane's
  reading as one more, naming the list"**: with `--base` the full build's listing, the plant's reading counts one more
  than the full build's reading of itself, names `test.tint@1.tone` among the lists saying instead: nothing and names it
  alone as added by this change, where the full build's names none added. **"The lane still passes"**: exit 0 and a
  PASS line on the plant's listing.
- **"The lane runs in the local preflight"** (AC8): a lane of `scripts/lanes.mjs` `checks` (what `scripts/checks.mjs`
  runs) lists `scripts/canvas-closures.mjs fields`; each such command, run from the checkout as listed right after the
  full build, passes and prints its reading. **"In under 5 s"**: the wall time of those commands, five runs after a
  warm-up on a fit reference Mac, by #412's judge. **"Reads no network"**: the same commands pass, with the same PASS
  and NOTE lines, inside the Seatbelt profile `(version 1)(allow default)(deny network*)`, which a control shows denies
  a child a connection to a listener on 127.0.0.1.

## Criteria to tests

| Criterion | Tests |
|---|---|
| AC1 `#2777.d820cdcc` | `seal.test.ts` (2): the full set with test.tone, tone unclosed, refused at startup with list_unclosed naming test.tint@1 and tone; its closed twin seals, its listing holding test.tint@1.tone closed |
| AC2 `#2777.45abf58c` | `lane.test.ts` (1): the lane passes on the full build's listing; every list the forms offer is in the listing, each with a closure of the rule's shape; the PASS line's count and count by closure and the reading's instead-nothing lists are the listing's; with camera@1.projection's closure taken out the lane fails, naming it |
| AC3 `#2777.728bbb54` | `table.test.ts` (1): the committed reference's generated block has a row for each of the ten |
| AC4 `#2777.c186d624` | `table.test.ts` (2): the committed reference passes drift against the full listing; dropping camera@1.projection's row fails naming it; material@1.translucency.kind's row with another reason fails naming it |
| AC5 `#2777.5fe304dc` | `refusal.test.ts` (2): projection fisheye refused with list, reopens_if and instead as the listing gives them (perspective presented); `refusal_bad_value_only` still refuses and fails the check, naming the code |
| AC6 `#2777.af753bc6` | `deep-kinds.test.ts` (1): op: closure on camera@1.projection and on every closed list answers the listing's reason, reopens_if and instead |
| AC7 `#2777.71fec45e` | `reading.test.ts` (1): with --base the full listing, the test-tone-closed listing's reading counts one more, names test.tint@1.tone and adds it alone; both runs pass |
| AC8 `#2777.a05e43e4` | `preflight.test.ts` (1): a lane of checks runs the lane; as listed it passes; with no network it passes with the same lines; under 5 s on a fit reference Mac |

Each test's name starts with its criterion and ID. Where a criterion names a wrong program, the test runs it (a test
feature, a planted startup argument, a planted reference on a scratch tree, or a planted listing) and asserts the
criterion's check fails, its failure naming what the criterion says.

## Expected readings, BLOCKED or INCONCLUSIVE

- AC8's timing reads INCONCLUSIVE on any machine but a fit reference Mac, this shared Mac among them (its loads run far
  past its core count); its structural, pass and no-network checks still run and can fail.
- AC8's no-network leg reads INCONCLUSIVE (platform) where there is no `/usr/bin/sandbox-exec`.
- Nothing else is gated: every other leg runs on any machine that builds `deep-show`.

## Not tested, because no criterion asks

`instead` on the hand-written table's closed rows and in `canvas-closures.json` (the Fields ask for it; no criterion
does); the lane's BLOCKED reading when it has no listing; the default listing and base the lane reads without
`--listing` and `--base` (AC8 reads only that the preflight's command passes); the generator's command; `deep_kinds` on
a registry or open list; a refusal for a value outside a nested list; the Proof line's runs, which `BASE-FAILURE.txt`
and the branch's run give.

## Files

- `helpers.ts`: the builds, `deep-show run` and its startup refusal, `kinds --dump` and `field_lists`, the form
  language's port and the places it offers, the closure and drift lanes and their lines, the generated table, scratch
  trees, the scene and the agent's deep_show, deep_kinds `op: closure`, the preflight's lanes and the no-network
  profile, the reference-Mac gate and judge, and the criteria's checks.
- `seal.test.ts` (AC1), `lane.test.ts` (AC2), `table.test.ts` (AC3, AC4), `refusal.test.ts` (AC5),
  `deep-kinds.test.ts` (AC6), `reading.test.ts` (AC7), `preflight.test.ts` (AC8).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.
