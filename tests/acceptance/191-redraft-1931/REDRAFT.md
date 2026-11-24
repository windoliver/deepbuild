# Blind redraft of #191's first criterion's test under #1931

#191's first criterion, `#191.8c7c5edf`, says "Rapier 0.36.1 passes every fixture on macOS arm64 and in the physics crate's wasm32 build, each within its tolerance, and the kit's report lists each fixture's measured value beside its answer". Both tests of `tests/acceptance/191/ac1-reference-kit.test.ts` also fail any fixture in the interface's data whose world isn't at g = 9.81 m/s², 120 Hz and 4 substeps. #1931 adds three force-law fixtures to the same kit and says "A world holding `inverse_square` or `lennard_jones` runs at `substeps: 1`. Another value is refused at check". A kit that meets #1931 holds its orbit and its pair at 1 substep, so the frozen tests fail on them by their own rule. This folder redrafts that one rule from the two issues, the design and the base `a0d3713a7`: a world holding `inverse_square` or `lennard_jones` is held to 1 substep, and every other world to 4, as before.

It was written blind, by a job that never saw an implementation of #1931. The original is not edited or deleted; a person approves the swap. Run with:

```
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/191-redraft-1931 --no-file-parallelism --testTimeout=600000
```

It imports `tests/acceptance/191/helpers.ts` unchanged and adds no helper. `criteria.ts` holds the criterion's ID, as `tests/acceptance/2009-redraft-2241/criteria.ts` does. Type-check: `node node_modules/typescript/bin/tsc -p tests/acceptance/191-redraft-1931/tsconfig.json`. The file builds what the frozen one builds: the debug `deep-physics` with the crate's default features, and the wasm32 library through `node scripts/physics-wasm32.mjs`. Both tests pass the frozen helpers' 60-minute timeout. On a machine other sessions share, the run goes through the throttle: `node scripts/throttle.mjs test --wait <minutes> --` before `node node_modules/vitest/vitest.mjs`. Vitest leaves a cache in `tests/acceptance/191-redraft-1931/node_modules`; remove it after a run.

## What was read

- #191's body and its one comment, and #1931's body (it has no comments), as the job's inputs hold them. The comment doesn't touch the first criterion.
- The base `a0d3713a74ce38caf4fdb4219cd34a0b971ade0e`: `tests/acceptance/191/` (the README, `helpers.ts`, `ac1` to `ac7` and `ac10` in full, and every line of `ac8`, `ac9`, `ac11` and `ac12` that reads the kit's fixtures or its report) and `tests/acceptance/191-oracle/` (which of its files call the kit: none); `tests/acceptance/2009-redraft-2241/` (all five files), `tests/acceptance/1718-redraft-1720/` and `tests/acceptance/1113-redraft-2833/` (`REDRAFT.md`) for the form; `docs/canvas-primitives.md` (Physics: behavior kit; Force; World and backend `physics.world@1`); `docs/technical-design.md` (Behavior kit; Dogfooding); AGENTS.md and CONTRIBUTING.md; `scripts/proof-change.mjs` (`criterionId`); `scripts/lanes.mjs` (its `alone` list); `scripts/physics-wasm32.mjs`; `scripts/throttle.mjs` and `docs/parallel-proof.md` (how a test grant is asked for and served); and, for surfaces only, `crates/deep-canvas-physics/src/kit.rs` and `kit/fixtures.rs` (the kit's `world`, which writes 120 Hz, 4 substeps and gravity (0, −9.81, 0) for every fixture of the base), `doc.rs` (how a force's `kind` is read, and the defaults of `step_rate`, `substeps` and `gravity`) and `crates/deep-physics-rapier/src/runner/kit.rs` (the kit's calls and the test backends' caps).
- `tests/acceptance/1931/`, untracked beside the base: #1931's own blind suite (README, `helpers.ts`, `ac6-kit.test.ts`). It is tests, not an implementation. It names the three fixtures `inverse_square_orbit`, `magnetic_gyration` and `lennard_jones_rest`, writes a force as the base does, `{"kind": {"<law>": {fields}}, "applies_to": [body ID]}`, and requires the orbit's and the pair's worlds to write `substeps: 1`.
- Outside the checkout: the log of this base's two builds, which the job was pointed to; and names only, no contents, of the throttle's folder and of the `deep-191-bin-*` temp folders, the second to check that this run left none.
- Nothing else: no other checkout, worktree or git ref, no implementation of #1931, no pull request, no web. The pinned backend's source was not needed.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old expectation no longer holds under #1931 | Replaced by |
|---|---|---|---|
| `191/ac1-reference-kit.test.ts` › #191.8c7c5edf macOS arm64: the reference backend passes every fixture within the issue's tolerance, listing each measured value beside its answer | #191.8c7c5edf (the first) | Its report judge ends with a rule over the interface's data: a fixture whose world isn't at 120 Hz, 4 substeps and g = 9.81 m/s² fails. #1931's Scope: "A world holding `inverse_square` or `lennard_jones` runs at `substeps: 1`. Another value is refused at check with `out_of_range`"; its first criterion runs the orbit "at 120 Hz and 1 substep", and its second says "The same orbit world at `substeps: 4` is refused at check". The design's kit line says the same of the orbit ("at 1 substep"), and its Force paragraph of both laws. So the orbit's and the pair's fixtures can't sit at 4 substeps, and at 1 the frozen rule fails them: `fixture inverse_square_orbit's world isn't at g = 9.81 m/s², 120 Hz and 4 substeps`, and the same for `lennard_jones_rest` | `ac1-reference-kit.test.ts` › #191.8c7c5edf macOS arm64: … each world at 4 substeps or, holding inverse_square or lennard_jones, at 1 (redraft 1931) |
| `191/ac1-reference-kit.test.ts` › #191.8c7c5edf wasm32: the physics crate built for wasm32-unknown-unknown passes every fixture within the issue's tolerance | #191.8c7c5edf | The same judge on the wasm32 build's data, so the same two fixtures fail it | `ac1-reference-kit.test.ts` › #191.8c7c5edf wasm32: … each world at 4 substeps or, holding inverse_square or lennard_jones, at 1 (redraft 1931) |

The changes, all of them (`diff` the two files):

1. The frozen rule's five lines move out of `reportFailures` into `worldFailures`, which `reportFailures` calls for each fixture where the lines stood. One comparison changes: `substeps !== 4` becomes `substeps !== due`, where `due` is 1 for a world whose `forces` hold an `inverse_square` or a `lennard_jones` and 4 for every other. The message names the substeps due and, at 1, the law.
2. `worldTwins` is new: the rule's planted mismatches (Wrong programs, below). Each test runs it on the `free_fall` fixture its own process answered. The frozen file plants a mismatch for its pass judge; this does the same for the rule that changed.
3. The macOS arm64 test gains one line before the frozen host check: a host that isn't macOS arm64 fails with `BLOCKED:` first, through the frozen helper `blocked`. The frozen check stays under it.
4. `AC` comes from `./criteria.ts` and the helpers from `../191/helpers.ts`; the header comment says what changed; each test's name ends with the rule and `(redraft 1931)`.

## Which world runs at which substeps

| World | Substeps | From |
|---|---|---|
| holds an `inverse_square` or a `lennard_jones` force | 1 | #1931, Scope: "A world holding `inverse_square` or `lennard_jones` runs at `substeps: 1`. Another value is refused at check". The design, Force: the same sentence, "since a held central force gains energy every orbit". The design's kit line: the orbit "at 1 substep" |
| every other | 4 | #191, Scope: "Fixtures at g = 9.81 m/s², 120 Hz and 4 substeps". The design, Physics: behavior kit: "Fixtures, with g = 9.81 m/s² at 120 Hz and 4 substeps" |

Every world, whatever it holds, is at 120 Hz and g = 9.81 m/s², as the frozen rule has it. #1931's fixtures are "at 120 Hz with gravity_scale 0": each body turns gravity off, and the world's gravity stays the kit's. A world that leaves `step_rate`, `substeps` or `gravity` unwritten is read at the document's defaults (120 Hz, 4 substeps, 9.81 m/s²), as the frozen rule reads it. So a world that holds `inverse_square` and writes no `substeps` is at 4, and fails.

Readings taken:

- **The rule follows the world's laws, not the fixtures' names.** The issues state it of "a world holding" a law. So it holds whichever fixture holds one, and needs no name from #1931's suite. A law is read from a force's `kind`: the one key of `{<law>: {fields}}`, or the name alone. Those are the two forms the base's reader takes.
- **The pair's fixture is at 1 substep.** The design's kit line gives the orbit "at 1 substep" and says nothing of the pair. The pair holds `lennard_jones`, so #1931's Scope and the design's Force paragraph put it at 1.
- **The gyration's fixture is at 4 substeps.** It holds `magnetic` alone. Neither issue and no line of the design gives a `magnetic` world a substep count of its own: #1931 says "the two laws that depend on position require one substep", its third criterion names none, and it applies the magnetic law "as the force that makes that turn over the step", held over the substeps like any force. So the kit's line holds it, as it holds every other fixture. #1931's suite leaves the gyration's `substeps` to the implementer and reads no value, so a kit with the gyration at 4 meets both suites. This is the one point where the two issues need a reading; it is the second item under What the owner decides.

## Kept as they are

- The rest of `reportFailures`, line for line: the report's backend, target, admission and verdict; each fixture #191 lists against the issue's answer and tolerance (`EXPECTED`, `passFailures`); each sensor cell's rows (`CELLS`, `cellFailures`) and the character cells against the caps rule; every result against the interface's data (its answer and tolerance, no `fail`, `excluded_by_caps` only with a cap lacking, no `pass` with one lacking); and every fixture having a result. These hold #1931's three fixtures as they hold any other, with no line changed: Rapier's caps claim the three laws under #1931, so each must pass.
- `freeFallAgrees` and the pass judge's planted mismatch (free fall's measured value 2% off a 1% answer), line for line.
- The rule's rate and gravity: 120 Hz and g = 9.81 m/s² for every fixture. #1931 changes neither.
- The frozen helpers, imported unchanged: `physics`, `wasm32`, `prebuild`, `fixturesOf`, `backendOf`, `kitReport`, `passFailures`, `cellFailures`, `none`, `caught`, `named`, `blocked`, and `TIMEOUT`, which each test passes.
- The other eleven files of `tests/acceptance/191/`, and `tests/acceptance/191-oracle/`, are not redrafted. No other file reads where a fixture's world runs, and none holds a rule that #1931's three fixtures make false. `ac4-excluded-by-caps` and `ac6-admission` are the two that read every result, each on a test backend. Their rule is the caps rule: a fixture naming a cap the backend lacks reads `excluded_by_caps`, and no other fails. #1931's suite has each of its fixtures name its law as a cap, so that rule holds them too. `ac6` also needs `rapier_caps` refused naming `soft_bodies`, which #1931 doesn't touch. The others read fixtures #191 lists, by name. `ac8-budgets` holds the whole kit under 60 s, which three short worlds don't decide. The oracle's files never call the kit. Whether #1931's work keeps #191's test backends as those files need them is the work's to show.

## Wrong programs

Both redrafted tests still fail on the frozen file's own wrong programs, through the unchanged lines: a report that names another backend or target, isn't admitted or doesn't read pass; a fixture #191 lists that is missing, not a pass, without a measured value, with another answer or tolerance, or measured outside its tolerance; a sensor cell whose rows are off the issue's steps; a result with no fixture in the interface's data, or with an answer or tolerance that isn't the interface's; any `fail`; a fixture its caps exclude that passes; a fixture with no result. The macOS arm64 test also fails on a kit whose free-fall measure isn't its bake's, and shows its pass judge catching the planted mismatch: a measured value 2% off a 1% answer.

Both also fail on a fixture's world at a rate, a gravity or substeps the issues and the design don't give it. Each test shows the rule catching these, planted on the `free_fall` fixture its own process answered:

- at 60 Hz;
- at gravity (0, 0, 0), which is gravity turned off in the world where #1931 says `gravity_scale: 0`;
- holding no force, at 1 substep;
- holding `inverse_square` at 4 substeps, and holding `lennard_jones` at 4 substeps, each failure naming the fixture, "1 substep" and the law. A kit with its orbit or its pair at 4 substeps is the one the frozen test asks for;
- holding `magnetic`, and neither of those two, at 1 substep.

And each shows the rule finding nothing wrong with the `free_fall` world as the kit holds it, with a world holding `inverse_square` at 1 substep, with one holding `lennard_jones` at 1, and with one holding `magnetic` at 4. So the test itself fails on a rule that reads no law, as the frozen one does, on a rule that takes 1 or 4 for any world, and on a rule that takes anything.

The planted worlds are the interface's own `free_fall` world with one field moved, or with one force added as #1931's suite writes it and `substeps` set. They are judged as data and never baked.

## Criterion ID

Both tests' names start with `#191.8c7c5edf`, from `criteria.ts`. It is the first criterion's ID as #191's body reads today, the same as the frozen suite's, computed the way `scripts/proof-change.mjs`'s `criterionId` does: the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed.

```
$ node -e 'const h=(t)=>"#191."+require("crypto").createHash("sha256").update(t.trim().replace(/\s+/g," ")).digest("hex").slice(0,8);const t=[...require("fs").readFileSync(process.argv[1],"utf8").split(/^###\s+Acceptance criteria\s*$/m)[1].split(/^#{1,6}\s/m)[0].matchAll(/^\s*- \[[ xX]\] (.+)$/gm)][0][1];console.log(h(t))' issue-191-body.md
#191.8c7c5edf
```

## What the owner decides

1. **The swap.** Whether, once #1931 lands, `tests/acceptance/191-redraft-1931/ac1-reference-kit.test.ts` runs in place of `tests/acceptance/191/ac1-reference-kit.test.ts`. Until then the original is the test that counts.
2. **The gyration's substeps.** The redraft holds a world with `magnetic` alone to the kit's 4. #1931's suite writes its own criterion-3 world at 1 substep, because the criterion's planted law "reaches … y = −1.514 m" only there: worked by hand from the criterion's values, that law's lowest y is −1.5136 m at 1 substep and −1.5135 m at 4. That is a reading of a wrong program's printed number, not a sentence of either issue, so it is not asserted here. If the owner reads the kit's gyration at 1 substep, `ONE_SUBSTEP_LAWS` gains `'magnetic'` and the two `magnetic` lines of `worldTwins` swap. The law itself runs at either: worked the same way, the half-angle rotation keeps the speed at every step and circles at 0.5000 m at 4 substeps and 0.5002 m at 1, inside #1931's 1%.
3. **The text.** The first criterion's own sentence names no substeps and can stand as written; its ID doesn't change. What can't be read as written, as a rule over every fixture the kit holds, is the line above the fixture lists:

   - #191, Scope: "Fixtures at g = 9.81 m/s², 120 Hz and 4 substeps: free fall (…)"
   - #191, Fields, and the design's Physics: behavior kit: "Fixtures, with g = 9.81 m/s² at 120 Hz and 4 substeps:"

   #191's lists hold none of #1931's fixtures, so as headings of those lists both lines are still true. The frozen test read them as a rule over the whole kit ("every fixture world at 120 Hz, 4 substeps, g 9.81", its README's first row), and the design's list under that line now holds the orbit "at 1 substep". The redraft is drafted against this wording:

   > Fixtures, with g = 9.81 m/s² at 120 Hz and 4 substeps, and at 1 substep where the world holds `inverse_square` or `lennard_jones`:

   An agent can't edit an issue's text. No criterion's text changes either way, so no ID changes.
4. **The design's kit line for the pair.** It gives the orbit "at 1 substep" and gives the pair none, though the pair holds `lennard_jones`. Saying it there too is the design's change, not this folder's.

## Lanes

Both tests build `deep-physics` and the wasm32 library, as #1931's files do, so the folder runs one file at a time. This job may not edit `scripts/lanes.mjs`. The implementer adds:

```js
// The blind redraft of #191's first criterion under #1931 builds deep-physics and the wasm32 library, as #1931's files do.
alone.push('tests/acceptance/191-redraft-1931/');
```

At this base `scripts/lanes.mjs` names no folder of #191's; that is not this folder's to change.

## Runs

At the base `a0d3713a7`, once, on macOS arm64 with Node 24.22.2, vitest 5.0.5 and cargo 1.99.1 (`BASE-RESULTS.txt`): the type-check exits 0 and 2 of 2 tests pass. They pass there because the base's kit holds no force-law fixture. Each of its 64 worlds is at 4 substeps, which is what the redrafted rule asks of a world holding neither law, and the 1-substep branch is reached only by the planted mismatches. So it is not the test that fails first for #1931; `tests/acceptance/1931/` is. The run went through the machine's throttle, after two 120-minute waits that brought no test grant; `BASE-RESULTS.txt` has them.

Not run: the redraft on a program that meets #1931, which this job never sees, and the original file. That the original fails on such a program is read from its rule and #1931's text, not from a run.
