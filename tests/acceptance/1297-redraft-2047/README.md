# Blind redraft of #1297's AC2 and AC3, for the closed-issue sweep (#2047)

Written blind at the base `ed28a8dce` (main with #1297's cascade bias, PR #1306, undone, and #1297's suite and
evidence left out), from issue #1297, the design and that base. The sweep reopened #1297 because no test on main names
its criteria; AC1 `#1297.d09869dd` is held by a suite on main this job didn't see, so nothing here is written for it.
This folder names AC2 and AC3. The job saw no fix, no earlier suite for the issue and no evidence of it; it read no
other commit, branch, worktree or pull request. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

## Sources

- **The issue**, #1297: its account of the bug (`cascade_lit`'s bias toward the sun since #424, the normal offset
  before it), the repro, its three criteria and the sweep's comment naming `#1297.b4935a37` and `#1297.a04bad6a`.
- **The design**, `docs/technical-design.md`: Films and figures on the canvas (3D scenes), Scenes, physics and the
  canvas core (the shadow map from the key light), the Caches row, How we know version 0 works (Dogfooding, Tests
  written first). **AGENTS.md.**
- **The base, for surfaces only**: `crates/deep-scene3d-render/src/scene3d.wgsl` (`cascade_lit`),
  `crates/deep-gpu-layer/src/golden.rs` (the fingerprint and the golden call), `crates/deep-show/reference-macs.json`;
  the suites `tests/acceptance/424/` (README, `redraft/section.test.ts`, `cutaway.test.ts`,
  `shadow-catcher.test.ts`, `taste.test.ts`, helpers), `tests/acceptance/422/` (README, `cascade-cache.test.ts`,
  `showpiece-fixture.test.ts`, `policy.test.ts`, `castle.test.ts`, `taste.test.ts`, `TASTE.json`, helpers) and
  `tests/acceptance/425/` (`TASTE.json`, `redraft/taste.test.ts`, helpers); `tests/goldens/422/`;
  `docs/evidence/422/`, `424/` and `425/`; `scripts/proof-runs.mjs` (`twinsOf`, the before lane, its 20-minute cap),
  `scripts/lanes.mjs` (`alone`, `slow`, `timed`, lane files), `scripts/size-ratchet.mjs`; for the house format,
  `tests/acceptance/2256-redraft-2047/`.

## Criteria to tests

IDs are the first 8 hex characters of SHA-256 of each criterion's text, trimmed and whitespace collapsed. Each test's
name starts with `AC<n> #1297.<id>` (from `helpers.ts`).

| ID | Criterion (short) | Test, and what it asserts |
|---|---|---|
| AC2 `#1297.b4935a37` | A flat face keeps its shadow edge where #424 put it: #424's cutaway suites and #422's cascade suites pass unchanged | `ac2-shadow-edge.test.ts` (2). The six files below and the helpers they import have the base's bytes (SHA-256 pinned); the checkout's own vitest runs the six, one at a time, and every test in them passes: none fails, is skipped or goes unreported. The first test judges all but #422's AC4 budget test; the second judges that one, which its suite runs only on a reference Mac |
| AC3 `#1297.a04bad6a` | Any golden, taste or pixel hash that moves in #422, #424 or #425 is reported; #425's `TASTE.json` is left for its owner | `ac3-moved-hashes.test.ts` (1). #425's `TASTE.json` has the base's bytes; `docs/evidence/1297/moved-hashes.json` lists all 19 hashes (below) with the base's recorded hash, the hash the change draws and `moved` exactly when the two differ; and, on a machine of the report's fingerprint, the test draws all 19 itself, with the owning suites' own calls, and each drawn hash is the report's |

## How each criterion is read

**AC2.** "A flat face keeps its shadow edge where #424 put it" is what #424's AC9 test,
`tests/acceptance/424/redraft/section.test.ts`, sees: the inner floor of a cut box is sunlit exactly where the roof's
cut edge, projected along the sun, says, to within 2 shadow-map texels, at two plane positions. The criterion's colon
makes the suites the check, so the test runs theirs unchanged rather than drawing a fixture of its own.

- **#424's cutaway suites** are the three files the issue names.
- **#422's cascade suites** are the files of #422's criteria that name the cascades: `cascade-cache.test.ts` (AC3, a
  cached cascade equals a clean render), `showpiece-fixture.test.ts` (AC4, the cascaded sun shadows within the
  showpiece budget, and seeking equals playing) and `policy.test.ts` (AC6, the cascade splits' closed form). Not
  counted: `castle.test.ts` (its goldens are AC3's here), `layers.test.ts` (writer layers), and the material, fog,
  bloom and window-budget files.
- **Unchanged** is held on the bytes: each of the six files and the helpers they import (`424/helpers.ts`,
  `424/redraft/helpers.ts`, `422/helpers.ts`) has its SHA-256 at the base. If an approved change to one of them lands
  later, its pin moves by the same approval.
- **Pass** is every test of theirs passing, none skipped or missing. A test of theirs that ends INCONCLUSIVE (its own
  rule: no Metal device, not a reference Mac) makes this one INCONCLUSIVE, never PASS; a failure anywhere is a FAIL,
  whatever else is INCONCLUSIVE. #422's helpers count only Mac15,7 and Mac15,12 as reference Macs, so its AC4 budget
  test reads INCONCLUSIVE on any other Mac, this one (Mac17,10) included. That test is judged by a test of its own
  here, so the shadow edge, the cutaways, the catcher, the cached cascades, the splits and the seek are judged on any
  Mac with a Metal device.

**AC3.**

- **The hashes** are the 19 pictures #422, #424 and #425 hold by hash, each keyed `<issue>/<kind>/<name>`, each with
  the hash the base records:

  | Key | Recorded at the base in |
  |---|---|
  | `422/golden/castle-t0` … `castle-t3` | `tests/goldens/422/castle-t<k>.golden.json`, its `digest` (the PNG's SHA-256; #422's AC1 compares them by pixel hash) |
  | `422/taste/castle-t0.png` … `castle-t3.png`, `furnace-metal.png`, `sunlit-metal.png`, `castle-orbit.apng` | `tests/acceptance/422/TASTE.json`, its `screenshots` |
  | `424/taste/engine-block.png`, `cutaway-shells.png`, `cutaway-section.png`, `additive-beams.png` | the files in `docs/evidence/424/` (#424 has no `TASTE.json` at the base) |
  | `425/taste/mesh-levels.png`, `band-blend.png`, `ladder-climb.png`, `orbit-zoom.apng` | `tests/acceptance/425/TASTE.json`, its `screenshots` |

  No other golden, taste record or stored pixel hash exists for the three issues at the base: #425's `pixel_hash`
  checks compare frames within one run and record nothing.
- **Drawn** is each picture as its owning test draws it, with that suite's own helpers and calls (imported, so a fix
  to them is a fix here): #422's from `castle.test.ts` and `taste.test.ts` (the goldens and the taste shots of the
  castle are the same four frames), #424's from `taste.test.ts`, #425's from `redraft/taste.test.ts`.
- **Moves** is: on the reporting machine, the program under test draws the picture other than its recorded hash.
  Pixels are machine-bound (#422's goldens are blessed under a fingerprint), so it is judged on one machine, the one
  the report names by the GPU layer's fingerprint (`os`, `gpu`, `driver`, `wgpu`, as the golden call gives it).
- **Reported** is `docs/evidence/1297/moved-hashes.json` (What the implementer provides). The test holds it to the
  pixels: on the report's fingerprint every drawn hash in it is what this program draws there; on another the run is
  INCONCLUSIVE, never PASS. Whatever the report says, the test prints what this program draws here as the report's
  body for this machine.
- **Left for its owner to re-record** is #425's `TASTE.json` keeping the base's bytes.

## What the implementer provides

1. **`docs/evidence/1297/moved-hashes.json`**, in exactly this shape, with the 19 keys above and no others:

   ```json
   {
     "issue": 1297,
     "criterion": "#1297.a04bad6a",
     "fingerprint": { "os": "27.2 (26B8119)", "gpu": "Apple M5 Max", "driver": "Metal", "wgpu": "30.0.1" },
     "hashes": {
       "422/golden/castle-t0": { "recorded": "5268e5c1…", "drawn": "<SHA-256 the change draws>", "moved": true },
       "…": "one entry per key"
     }
   }
   ```

   `fingerprint` is the GPU layer's on the machine that drew it (above, this Mac's), `recorded` the base's hash from
   the table, `drawn` the hash the change draws there, and `moved` is true exactly when `drawn` and `recorded`
   differ. A run of `ac3-moved-hashes.test.ts` on that machine prints this body for the program it ran on.
2. **`scripts/lanes.mjs`**: `'tests/acceptance/1297-redraft-2047/'` in `alone` (both files draw on the GPU, and the
   AC2 file runs other suites' Metal files), as #422's, #424's and #425's folders are. A lane file can't say it here:
   `LANE_FILE` takes only a numbered folder.
3. **`scripts/size-ceilings.json`**: the twin
   `tests/acceptance/1297-redraft-2047/twins/normal-offset/crates/deep-scene3d-render/src/scene3d.wgsl` at 3390 lines
   (the base's shader with one line changed), as other twins of large files have.

## What can't be held

- **Where "reported" lives.** Neither the issue nor the design names a place, so the report file is this suite's
  choice. A PR note or an issue comment is not read; the file is the report.
- **Moved by the change, or off its record already.** The test has no program of the base to draw with, so it can't
  tell a hash the change moved from one that was already off its record on that machine: both read `moved: true`. On
  this Mac 18 of the 19 are off their record at the base already (only `422/taste/furnace-metal.png` matches), since
  the records were drawn on other machines or before later changes. The report says what the change draws against
  each record, which is what an owner re-records from.
- **Another machine.** On a fingerprint other than the report's, AC3 is INCONCLUSIVE; so is the `unreported-move` twin
  off this Mac's fingerprint (below).
- **#422's AC4 budget** is judged only on one of #422's reference Macs (Mac15,7 or Mac15,12): AC2's second test is
  INCONCLUSIVE elsewhere.

## Twins

`twins.json` maps each criterion to wrong programs the proof lanes lay over the change (`scripts/proof-runs.mjs`,
`twinsOf`):

| Twin | The wrong program | Criteria | Where it fails (run at the base, below) |
|---|---|---|---|
| `normal-offset` | `cascade_lit` looks up the shadow map at `world + n * (1.5 * texel)`, the normal offset from before #424, in place of the bias toward the sun: one line of the base's `scene3d.wgsl` | AC2, AC3 | AC2's first test, at its `none`: `424/redraft/section.test.ts`'s AC9 fails, the sunlit floor beside the shadow line reading 20.3 to 21.2 against 22.508 within 5% (3 of 12,183 px at the plane's offset 0, at z −0.829 with the line at −0.849; 2 of 8,414 px at −0.4), the issue's "fails AC9 by a few pixels". AC3, at its `none`: 13 of the 19 draw other than the report says (the castle's four frames as goldens and taste shots, its orbit, and #425's four) |
| `unreported-move` | a report that says nothing moved, every drawn hash its recorded one, under this Mac's fingerprint | AC3 | AC3, at its `none`: the 18 hashes off their record each read "a moved hash left unreported" |

The `normal-offset` shader is the base's whole file: over a change that also edits the shader's bindings elsewhere it
may not build, which the lanes read as BLOCKED, never as a pass. The `unreported-move` report is bound to this Mac's
fingerprint, so on another machine it reads INCONCLUSIVE.

## What was run

On this Mac (Mac17,10, Apple M5 Max, macOS 27.2), at the base, with nothing else changed unless said:

- `cargo build --locked --bin deep-gpu` from nothing: 28 min 39 s at a load of about 130; `--features test-meter` after
  it: 27 s.
- **The suite, once, at the base**: 96 s at a load of about 20.
  - AC2's first test **passes at the base**: the six files ran and their 10 judged tests passed (in a direct run of
    the same six: section 15 s, cutaway 4 s, shadow-catcher 9 s, cascade-cache 10 s, showpiece's seek 30 s, policy
    4 s). AC2's second test is **INCONCLUSIVE**: #422's budget test says "not a reference Mac (Mac15,7 or Mac15,12):
    hw.model is Mac17,10".
  - AC3 **fails at the base**, at its `none`: "`docs/evidence/1297/moved-hashes.json` is missing: no hash is
    reported". It drew all 19 pictures in about 45 s; 18 are off their record here (all but
    `422/taste/furnace-metal.png`).
- A second run drew the same 19 hashes, byte for byte.
- A control, not committed: with the body AC3 printed at the base written to the report path, AC3 passes (40 s). So
  the test can pass, and passes only on a report that matches the pixels.
- The `unreported-move` twin laid at the base: AC3 fails as the table says (56 s).
- The `normal-offset` twin laid at the base, with the control's report standing in for the change's: the rebuild took
  41 s and the suite 115 s; AC2's first test and AC3 fail as the table says, AC2's second is INCONCLUSIVE.
- After that run, `helpers.ts` was changed to keep three lines of each inner failure, and `ac2-shadow-edge.test.ts`
  to read INCONCLUSIVE from a failure's first line only; AC2's first test was rerun alone on the twin (44 s, the same
  failure, now with the floor's numbers) and its second alone at the base (50 s, INCONCLUSIVE as before).
- `node node_modules/typescript/bin/tsc -p tests/acceptance/1297-redraft-2047/tsconfig.json`: exit 0.
- Not run: the proof lanes themselves (`scripts/proof.mjs`), and the suite on a reference Mac of #422's or on the
  change.

## Run them

```sh
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --no-file-parallelism --testTimeout=600000 --hookTimeout=600000 tests/acceptance/1297-redraft-2047/
node node_modules/typescript/bin/tsc -p tests/acceptance/1297-redraft-2047/tsconfig.json
```

Every test draws on macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes.
The files build `deep-gpu` (default, and `--features test-meter` for #425's climbing view) as #422's, #424's and
#425's suites do, and write only into temporary folders they delete.
