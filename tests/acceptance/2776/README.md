# Acceptance tests for #2776: a Paths row for real-time rays, a final and the web player, sealed with the entry, and a lane that fails a row left empty

Written first, blind, from issue #2776 (live, November 19, 2026: its Scope, its Fields, its eight acceptance criteria,
its Proof line and Depends on), the design sections it links and the base commit `a42e4f03d` ("Merge pull request
#2841"), by a job that never saw an implementation; none existed. No other worktree, branch, PR, stash or plan was
read, and no comment on the issue. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue's body, read live with `gh issue view 2776`; its criteria IDs computed with `criterionId` of
  `scripts/proof-change.mjs` (they match the IDs below).
- `AGENTS.md`; `docs/technical-design.md`: How we know version 0 works (Dogfooding, Tests written first, Wrong
  programs), Rules every primitive follows (whole), The canvas core and Canvas modules (whole).
- `docs/canvas-primitives.md`: the opening paragraph (the template), Registries and closed lists, Canvas module,
  Canvas module: interface and implementation, Registry and seal, Registry and seal: registries, Light: ray traced,
  Export: path-traced finals, Export: web player and its two sections (compressed sound; the ladder and a tier), and
  the template rows of Material: water, Material: subsurface, Marks in 3D and its sections, Light and the light policy.
- At the base, for surfaces only: `scripts/canvas-closures.mjs` (the `closures` and `drift` commands, their lines and
  exits), `packages/contracts/canvas-closures.json` and `canvas-registries.json`, `scripts/lanes.mjs` (the lint lane,
  `alone`), `scripts/affected.mjs` (`LIGHT`), `scripts/proof-runs.mjs` (how `twins.json` is read);
  `crates/deep-show/src/main.rs` (the seal and its `seal_refused` line), `src/kinds.rs` and `src/kinds/replies.rs`
  (`deep_kinds`, `kind_rows`, `kinds --dump`), `src/export/web.rs` and `src/export/run.rs` (the web export's refusals,
  module sets and receipt), `crates/deep-canvas/src/registry` (fixtures, check kinds, the core's mark and modifier
  entries), `crates/deep-canvas/src/document/check.rs` (`requires.modules`), `crates/deep-canvas-scene3d/src/module.rs`
  (`register_with`, names only) and `src/scene.rs` (`is_3d`), `crates/deep-canvas-test-modules` (`test.native` drawn
  as `rect@1`), `crates/deep-player/web/dist/*/player.json` (the module sets);
  `packages/contracts/canvas-schemas/kinds.dump@1.json`. The suites `200` (closest: the closure lane on scratch trees,
  test modules, the seal's refusal), `305`, `412` (`deep_kinds` and the dump), `172` and `1490` (the web export, its
  refusals and `test-web-lacks`), `169` (the scenario and `deep show`).

Code was read only to learn the surfaces. Every expected value comes from the issue's text and the design.

## What the base already does, which these tests don't credit

The closure lane runs `closures` and `drift` (#200) and prints `BLOCKED closures: usage …` with exit 3 for any other
command. The seal refuses a set with one `seal_refused` line and exit 2, naming modules, arrays, an interface or a
registry and its entries. `deep_kinds` lists every registry's entries in one shape and `deep-show kinds --dump` writes
the sealed listing (#412), with no answers in either. The web export refuses a status binding, a capture, a strip, a
video background, a video point set, a video image and a module the player's set lacks (#172, #1490), from a list of
its own, and its receipt's `refused` names each port it leaves out. None of the reference's 458 sections carries a
Paths row; there is no `paths` command, no `packages/contracts/canvas-paths.json`, no `paths` on any entry, no
`test-paths*` feature and no `web_export_carries_refused` plant.

## Run them

Put the pinned toolchain first on PATH; in a fresh worktree run `npm ci` and `npm run build --workspaces` once:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2776 lane.test.ts --testTimeout=1800000
for f in seal export listing; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/2776 $f.test.ts --testTimeout=1800000 --hookTimeout=7200000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/2776/tsconfig.json   # type check
```

`lane.test.ts` builds nothing: it runs the lane on scratch trees and on the checkout, a second or two in all.
`seal.test.ts` builds `deep-show` with `full,test-paths-no-final` and `full,test-paths`; `export.test.ts` and
`listing.test.ts` build `full,test-paths`. Each file builds its sets once in `beforeAll` (`cargo build --locked --bin
deep-show --no-default-features --features <set>`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set), copies the binary out under its own name and fails each test that uses a
build that failed; the two sets differ only in the test module, so the second builds warm. Every test passes an
explicit timeout (`1_800_000` ms), the builds `7_200_000`. Temporary folders are deleted after each test or file. Node
built-ins and vitest only.

`scripts/lanes.mjs` needs this line (the three files build cargo binaries; this job writes only its folder, and the
implementer adds it):

```js
// #2776's files build deep-show (full with the test module test.paths) and export 3D scenes to the web.
alone.push('tests/acceptance/2776/seal.test.ts', 'tests/acceptance/2776/export.test.ts', 'tests/acceptance/2776/listing.test.ts');
```

`lane.test.ts` stays on the parallel line.

## The surface under test

The paths lane, run as the local preflight runs it; `deep-show run` as #393, #200, #412, #172 and #1490 left it (one
scenario line in, one answer line out; `deep show`, `export` with `video: {codec: "web"}`, `deep_kinds`, `registry`;
the scenario's `planted` key; the `seal_refused` startup line with exit 2); `deep-show kinds --dump <dir>`; test
canvas modules behind `deep-show` `test-*` features. **Every name marked *(chosen)* is this job's**, the smallest
surface consistent with the design and the base; the implementer builds exactly these, or a dispute goes to a blind
redraft.

### The answers as data

An answer is one of four, the issue's `same {held_by}` | `stand_in {draws, receipt}` | `refused {code}` |
`not_applicable {why}`, written as JSON tagged by `answer` *(chosen)*:

```json
{"answer": "same", "held_by": "<check kind> | <module>/<fixture>"}
{"answer": "stand_in", "draws": "<words>", "receipt": "<words>"}
{"answer": "refused", "code": "<code>", "task": "#<n>"}        // task: the open task that decides it, where one does
{"answer": "not_applicable", "why": "<words>"}
```

A fixture is named `<module>/<fixture name>` *(chosen)*: the `fixtures` call's `module` and `name`, `core` for the
core's. Where the design is silent the answer is `refused` with `path_undefined` (the issue's Scope).

- **`deep_kinds` *(chosen)*:** in `{"call": "deep_kinds", "op": "list", "registry"?, "cursor"?}`, each entry that draws
  in 3D (of `kind@1`, and of any other registry whose entries the implementer seals as 3D) carries `"paths": {"rays":
  Answer, "final": Answer, "web": Answer}`; a field that carries its own answers carries the same `paths` on its row in
  the entry's `fields`.
- **`deep-show kinds --dump <dir>` *(chosen)*:** the same `paths` on each such entry and field row of the dump
  (`kinds.dump@1` takes the member).

### The Paths row *(chosen)*

In a section of `docs/canvas-primitives.md` (a `#### ` heading, to the next heading of level 1 to 4), beside its
Fields … Lands rows, after **It can never:** and before **Lands:**, once per section: the line `**Paths**`, a blank
line, and a table headed exactly `| Entry | rays | final | web |`, then `|---|---|---|---|`, then one line per holder
of answers; the table ends at the first line that doesn't start with `|`. From `fixtures/reference.md`:

```md
**Paths**

| Entry | rays | final | web |
|---|---|---|---|
| `test.paths.halo@1` | `refused` `path_undefined` (#2759) | `refused` `path_undefined` (#2759) | `stand_in`: nothing, the web player leaves the halo out (receipt: halo left out) |
```

- **The holder cell** is one code span naming the holder: `<entry>` for an entry of `kind@1` (`` `test.paths.glow@1` ``);
  `<entry>.<field>` for a field that carries its own answers (`` `test.paths.mist@1.depth` ``; the field starts at the
  first `.` after `@<major>`, as #1971's `op: field` paths do); `<registry>/<entry>[.<field>]` for an entry of another
  registry (`` `modifier@1/mod.subdivide@1` ``).
- **An answer cell**, trimmed, is one of: `` `same`, held by `<check kind or fixture>` ``; `` `stand_in`: <draws>
  (receipt: <receipt>) `` (draws runs to the last ` (receipt: `); `` `refused` `<code>` ``, followed by ` (#<n>)` where an
  open task decides it; `` `not_applicable`: <why> ``. Words hold no `|`.
- **Several entries, or a field.** A section whose primitive is several sealed entries (Marks in 3D's marks) gives each
  its own table line; a section about a field of an entry (Material: water, Material: subsurface) gives the field's
  line (`` `material@1.water` ``). An entry's own line and its fields' lines may sit in different sections.
- **Which sections carry a row**: exactly those the sealed listing names as a holder's `section`, the heading's text as
  written (backticks included). The lane takes no word scan; the issue's 117 is its author's scan, not a rule.

### The sealed listing *(chosen)*: `packages/contracts/canvas-paths.json`

A committed snapshot of what the `full` build seals, beside `canvas-closures.json` and `canvas-registries.json`, as
`crates/deep-show/schedule/*.json` is of the sealed plan (#387): the lane can't build. One element per sealed 3D entry,
and per field of one that carries its own answers, outside test modules:

```json
{
  "checks": ["<check kind>", "…"],
  "fixtures": ["<module>/<fixture name>", "…"],
  "entries": [
    {"entry": "<name@major>", "registry": "kind@1", "field": "<field> (only on a field's element)", "module": "<canvas module>",
     "section": "<the reference section's heading text>", "paths": {"rays": "Answer", "final": "Answer", "web": "Answer"}}
  ]
}
```

`checks` holds every check kind the sealed set holds, `fixtures` every fixture of every sealed module. A deep-show unit
test holds the file equal to the seal (the implementer's, as #200's holds `canvas-registries.json`'s rows); this suite
proves it against the build: `listing.test.ts` compares every 3D entry and field the `full,test-paths` dump carries
answers for (test entries left out) with the file, both ways.

### The lane *(chosen)*

`node scripts/canvas-closures.mjs paths [--root <tree>]`, beside `closures` and `drift`. It reads
`<tree>/docs/canvas-primitives.md` and `<tree>/packages/contracts/canvas-paths.json` and nothing else: it draws
nothing, opens no socket, looks up no name and starts no process. It fails:

- a holder whose section isn't in the reference, or has no Paths row, or whose row has no line for it (naming the
  section, and the holder where the row is there);
- a cell whose answer differs from the listing's in any member (answer, `held_by`, `draws`, `receipt`, `code`, `task`,
  `why`), or can't be read (naming the section, the holder and the path);
- a line in a row for a holder the listing doesn't give that section (naming the section and the holder);
- a `same` with nothing that holds it, or held by a name in neither `checks` nor `fixtures` (naming the section, the
  holder and the path).

Lines, in any order:

- `same paths: <path>: <holder>: held by <check kind or fixture>`: one for each `same` in the listing that a check or
  fixture holds;
- `count paths: <path>: same <n>, stand_in <n>, refused <n> (path_undefined <n>), not_applicable <n>`: one for each of
  rays, final and web, counted over the listing's elements, so each line's four counts sum to them;
- `FAIL paths: <section>[: <holder>[: <path>]]: <why>`, one per failure;
- `PASS paths: <words>` when nothing failed; `BLOCKED paths: <file> is missing` when a file is.

Exit 0, 1, or 3 when blocked. The lint lane of `scripts/lanes.mjs` runs `[node, scripts/canvas-closures.mjs, paths]`
as the command right after `[node, scripts/canvas-closures.mjs, drift]`; `scripts/affected.mjs`'s `LIGHT` already
names the script.

### The seal's refusal *(chosen)*

A sealed entry that draws in 3D, with no answer for a path, refuses startup: #305's line (exit 2, before any scenario
is read) with `"reason": "path_unanswered"`, `"entry": "<name@major>"` and `"path": "rays" | "final" | "web"`, beside
`modules` and `what`; where several are missing, the first by entry name, then rays, final, web.

### The web export *(chosen)*

`{call: "export", doc, out, video: {codec: "web"}}`, #172's call. Before it picks the player's set, the export reads
each item's web answer: its entry's, and that of each field the item sets that carries its own.

- **`refused`**: the export is refused as #172 refuses (`outcome: "refused"`, nothing written), its `refused` list
  holding `{"item": <item ID>, "code": <the answer's code>, "entry": <holder>, "path": "web", "why": <message>}`, whatever
  set would carry the item. An item of a module no set holds also gets #1490's `module_missing` entry beside it.
- **The message** (`why`) names the holder, the path (the word `web`) and, for `path_undefined`, the answer's `task`
  where it has one; its other words are free, e.g. "test.paths.mist@1 has no answer for the web path: path_undefined
  until #2759 decides it".
- **`stand_in`**: the export goes on, and its receipt gains `"stand_in": [{"item", "entry": <holder>, "draws": <the
  answer's draws>, "receipt": <the answer's receipt>}]`, the words byte for byte; the item is no refusal. The player
  draws the stand-in, not the entry, so a module whose only uses in the document are stand-in items (their kinds and
  params, and `requires.modules` naming it) is not one the player's set must hold.

### Test canvas modules and features of `deep-show` (none in a shipped build)

| Feature | What the build holds |
|---|---|
| `test-paths` | the full set and module `test.paths` 1.0.0, which requires scene3d. Three kinds, each `{size: [m, m, m] = [1, 1, 1]}` and drawn as scene3d's box mark `mark.box@1` (as #172's `test.native@1` is drawn as `rect@1`), so each puts a box's shape and shading into the 3D frame and the seal holds it to the paths rule as it holds scene3d's own kinds: `test.paths.glow@1`, `test.paths.halo@1` and `test.paths.mist@1`, with the answers below; and the fixture `glow`, a scene holding one glow, so `test.paths/glow` exists. Their section, if a declaration carries one, is `Test paths`; nothing reads it for a test module |
| `test-paths-no-final` | the same, with `test.paths.mist@1` declaring its rays and web answers and none for a final |

| Kind | rays | final | web |
|---|---|---|---|
| `test.paths.glow@1` | `same`, held by `test.paths/glow` | `not_applicable`: drawn after lighting, as in the real-time export | `refused` `test.paths.no_web` |
| `test.paths.halo@1` | `refused` `path_undefined` (#2759) | `refused` `path_undefined` (#2759) | `stand_in`: nothing, the web player leaves the halo out (receipt: halo left out) |
| `test.paths.mist@1` | `refused` `path_undefined` (#2759) | `refused` `path_undefined` (#2759) | `refused` `path_undefined` (#2759) |

`#2759` is an issue number only; any would do.

### Planted programs

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| feature `test-paths-no-final` | the module above, its 3D kind with no answer for a final | 1 | `test.paths.mist@1`, `final` (the seal's refusal) |
| `web_export_carries_refused` *(chosen)*, the scenario's `planted` | the web export reads no `refused` web answer: it takes it as a stand-in and writes the bundle with the item in it | 6 | the item, `glow` |

At the base an unknown `planted` name answers `bad_input`.

### Fixtures

- `fixtures/reference.md`: a scratch reference of five sections in the template: Test glow, Test halo and Test mist (the
  three kinds, as the table above), Test mist: depth (the field `test.paths.mist@1.depth`: rays `same` held by the check
  `geometry.audit`, final `refused` `path_undefined` (#2761), web `not_applicable`), each with its Paths row; and Test
  plate, a 2D section with none.
- `fixtures/canvas-paths.json`: its sealed listing: those four holders, `checks` `document.validate` and
  `geometry.audit`, `fixtures` `test.paths/glow`.
- Made in test code: the plants of AC2, AC3 and AC5 (below), each a copy of a reference or listing with one change.

## Criteria to tests

| Criterion | Tests |
|---|---|
| AC1 `#2776.e33547f5` | `seal.test.ts` (1): `full,test-paths-no-final` refuses to start, `path_unanswered`, naming `test.paths.mist@1` and `final`; its twin `full,test-paths` (mist's final `refused` `path_undefined`) seals with `test.paths` among the modules |
| AC2 `#2776.43b1fe3a` | `lane.test.ts` (2): the scratch tree passes, and with Test halo's final cell planted `same` (held by a fixture that exists) where the listing says refused it fails, naming Test halo and final; with Test mist's Paths row taken out it fails, naming Test mist |
| AC3 `#2776.c440ce00` | `lane.test.ts` (1): glow's rays `same`, held by `test.paths.nowhere`, in the row and the listing alike, fails the lane, naming `test.paths.glow@1` |
| AC4 `#2776.cab3192b` | `lane.test.ts` (2): on the checkout the lane passes, its three counts lines are the counts of `canvas-paths.json` (each summing to its elements, path_undefined within refused) and the listing's refusals name #2759, #2761, #2762, #2772, #2773, #2774 and #2775; on the scratch tree the counts are exactly the fixture's |
| AC5 `#2776.9ecba479` | `lane.test.ts` (2): the scratch tree's two `same` lines with what holds each, and every `same` of the first fill listed with its holder, each in `checks` or `fixtures`, as many per path as its count; the first fill passes, and with its first `path_undefined` cell planted `same` with nothing that holds it, in the row and the listing alike, it fails, naming that holder and path |
| AC6 `#2776.c726fb11` | `export.test.ts` (3): the scene holding glow is refused, nothing written, glow given `test.paths.no_web`; the scene holding halo exports, its receipt's `stand_in` listing halo with `test.paths.halo@1` and the answer's words; `web_export_carries_refused` fails the first check, naming glow |
| AC7 `#2776.95a7c6cc` | `listing.test.ts` (3): `deep_kinds` list returns glow's, halo's and mist's three answers as declared (all four answers among them); the scene holding mist is refused, its entry for mist carrying `path_undefined`, `entry` mist, `path` web and a message naming mist, web and #2759; every 3D entry and field the dump carries answers for is in `canvas-paths.json` with the same answers, and the file holds nothing more |
| AC8 `#2776.7c0bede8` | `lane.test.ts` (3): the lint lane runs `paths` right after `drift`; five runs on the checkout after a warm-up each under 2 s (the design's judge); under a guard that records every socket, lookup, request and child process (shown to record a lookup and a fetch) the lane passes with none recorded |

17 tests. Each test's name starts `AC<n> #2776.<h8>`. Where a criterion names a wrong program, the test runs it (a
planted feature, the scenario's `planted`, or a planted tree) and asserts the criterion's check fails, naming what the
criterion says.

## Readings where the issue leaves a choice

- **"Draws in 3D"** for a test kind: drawn as scene3d's box mark, which puts shape and shading into the 3D frame. How
  the seal knows a kind draws in 3D is the implementer's; a module must not escape the rule by declaring nothing.
- **"Refused at the seal, naming the kind and the path"** (AC1): the startup refusal's `entry` and `path`; "its twin
  seals": the same module with the final declared `refused` with a code (`path_undefined`), which starts.
- **"A planted reference section whose row says same where the listing says refused"** (AC2): the scratch reference
  with one cell changed, the `same` held by a fixture that exists, so only the disagreement can fail it. **"A 3D section
  with no row"**: a section the listing names for a holder, its row taken out; a line about another section (Test mist:
  depth) doesn't count as naming Test mist.
- **"A check no registry holds"** (AC3): a `held_by` in neither `checks` nor `fixtures`, written as a check kind's name.
- **"On main after the first fill"** (AC4): the checkout the suite runs in. Values the issue doesn't give are read for
  consistency with the committed listing; the seven open tasks are the issue's (Scope). The fixture's exact counts
  show the counting itself.
- **"A planted fill that marks a silent section same"** (AC5): the first fill copied, its first `path_undefined` cell
  (listing order, then rays, final, web) set to `same` with nothing named, in the row and the listing alike, so only
  "never call a path same with nothing that holds it" (the issue's Fields) can catch it. A `same` naming something that
  exists is beyond the lane, which knows only that it exists (the issue's Scope).
- **"Refused with that entry's code"** (AC6): the entry's own code among the refusal's entries for the item; the test
  module is in no player set, so #1490's `module_missing` may stand beside it. **"With the answer's words"**: `draws` and
  `receipt` byte for byte. **The stand-in's module**: for the halo piece to export, the player's set needn't hold a
  module only stand-ins use (The web export, above); that is what drawing the stand-in instead means.
- **"A planted export that carries a refused entry fails, naming the item"**: this suite's check (refused, nothing
  written, the item given the entry's code) fails on the plant, naming the item, whether the plant's export is then
  refused for another reason, fails a read-back or writes the bundle.
- **"A refusal's message"** (AC7): the `why` of the refusal the web export gives the item, the one landed path on which a
  document asks for a path; the issue's Fields give the refusal as `path_undefined {entry, path}`, so it carries both.
  Rays (#475) and finals (#178) aren't built, so no document can ask for them yet.
- **The listing equals the seal**: checked through the dump, the whole sealed listing (#412); `deep_kinds` is read for
  the test entries' answers.
- **"Beside the closure lane"** (AC8): the next command after `canvas-closures.mjs drift` in the lint lane. **"Under 2 s"**:
  five runs after a warm-up, each from spawn to exit, judged by the design's rule (PASS all within, FAIL all past the
  limit by more than the margin, the larger of 5% and their spread, else INCONCLUSIVE), with no reference-Mac gate, since
  the issue runs it on any machine. **"Reads no network"**: the guard, an `--import` module that records and refuses
  `net`, `tls`, `dns`, `http`, `https`, `http2`, `dgram`, `child_process` and `fetch`.

## Twins

The lane's wrong programs, proved in a scratch folder only: a throwaway lane written to this README (the base's
`closures` and `drift` with a `paths` command), its twins, each one change to it, and a fabricated first fill (rows in
Marks in 3D, Material: water, Material: subsurface, Sky `sky@1` and Modifier; the seven tasks among them; `same` held
by a fixture; a `stand_in` in another registry). Every test of `lane.test.ts` ran once on each; none is committed, so
the folder hands over no lane.

| Program | Fails | Passes |
|---|---|---|
| the throwaway lane | none | all 10 |
| `reads-listing-only`: never reads the reference | AC2 ×2 (exit 0 where 1 is due) | the other 8 |
| `fails-unnamed`: one FAIL line naming nothing | AC2 ×2, AC3, AC5 plant (no line names the section, path or entry) | the other 6 |
| `same-unchecked`: a `same`'s holder unchecked | AC3, AC5 plant (exit 0) | the other 8 |
| `counts-undefined-apart`: path_undefined refusals left out of `refused` | AC4 ×2 | the other 8 |
| `no-same-lines`: no `same` lines | AC5 listing | the other 9 |
| `no-row-ok`: a section with no row passes | AC2 no-row (exit 0) | the other 9 |
| `looks-up-host`: looks up `localhost`, error caught | AC8 network (`node:dns.lookup` recorded) | the other 9 |
| `slow`: 2.5 s before it reads | AC8 timing (judged FAIL) | the other 9 |
| `lint-without-paths`: the base's lint lane | AC8 lint lane | the other 9 |

The Rust legs have no throwaway: AC1's wrong program is its planted feature, AC6's its plant, and each of the three
files fails on the merge base at an assertion (`BASE-FAILURE.txt`).

## Legs that read BLOCKED or INCONCLUSIVE

Never a pass. AC8's timing skips as INCONCLUSIVE when its five readings straddle 2 s within the margin. `export.test.ts`
builds the halo bundle's fallback page, which renders on the GPU as #172's exports do; without one the export fails,
and the test with it.

## Not tested, because no criterion asks

A document refused at check for asking rays or a final (neither is built); field answers on the Rust side (the lane's
fixture has one); a row's line for a holder the listing doesn't hold, a second Paths row, or a difference in a task or
words alone (the lane's rules above; no criterion plants them); the amended template text and Rules every primitive
follows (docs); the issue's word-scan count; which shipped entries the first fill answers which way, beyond the seven
tasks.
