# Round 2 (2026-11-17): what is in this folder

Every saved output starts with its command and its Node version. `<home>` stands for the home folder.
The merge base and this checkout's HEAD are both `ed03dc60d51abe3d96cf61b766ecf92057a780eb`.

- `repair.diff`: `diff -ru` of each changed file against its original in `.orig2/`, and the one new file.
- `sha256-unchanged.txt`: the 27 files of the three acceptance folders this round left alone, then the seven it
  changed or added, before and after.
- `cap.sh`: the wrapper that saved most outputs. `before-tsc-*` / `after-tsc-*`: the type checks, same one error each.
- `after-affected-list-BLOCKED.txt`: `scripts/affected.mjs --list` needs cargo, which this shell doesn't have.

## Defect 1: the probe subtracted two counters

- `before-two-counters-no-archive.txt`, `before-three-counters.txt` (`three-counters.mjs`): `rss()`, `ps` and
  `maxRSS` side by side on both Node builds. They agree on 24.22.0; on 24.22.2 `rss()` is a constant 38 MB or so
  under the other two, which agree with each other.
- Throwaway archives: `alloc-nothing.mjs` (waits 300 ms), `alloc-100mb.mjs` (holds a touched 100 MB buffer),
  `alloc-100mb-transient.mjs` (100 MB held only inside one synchronous step, back down before any sample).
- `probe-runs.sh` runs `probe/pass.mjs` on one of them, three times per Node build:
  `before-probe-*.txt` / `after-probe-*.txt` (`nothing`, `100mb-held`, `100mb-buffer-dropped-at-once`,
  `100mb-transient`). `before/probe/` is the probe folder's three files as they were, byte for byte, used for the
  `transient` before-run and the proof table's.
- `measured-pass.proof.ts` + `measured-pass.config.ts` run `heavy/run.ts`'s `measuredPass` on them:
  `before-measured-pass-node-*.txt`, `after-measured-pass-node-*.txt`, and
  `before-measured-pass-with-only-the-probe-repaired-node-24.22.2.txt` (why `run.ts` needed the repair too).
- `before-heavy-ac1-node-*.txt` / `after-heavy-ac1-node-*.txt`: `heavy/ac1` at the base on each Node build.
  The criterion test fails (the base stores 27.8 MB a pass) and the twin test passes, before and after.
- `after-heavy-ac2-node-24.22.0.txt`: `heavy/ac2` at the base still fails as its README says (no before-run).
- `before-proof-table-node-24.22.2.txt`, `after-proof-table-node-*.txt`: `probe/proof.mjs` still reads the result
  line (run on `alloc-nothing.mjs`, so the rows are not the issue's Proof).

## Defect 2: the AC5 redraft could not run the merge base's archive

- `before-ac5-suite.txt`, `before-ac5-perf.txt` (and `-first-test`), `before-ac5-meter.txt`: 12 and 6 BLOCKED, 1 passed.
- `after-ac5-suite.txt`, `after-ac5-perf.txt`, `after-ac5-meter.txt` (Node 24.22.0): 12, 6 and 1 passed.
  `after-ac5-suite-node-24.22.2.txt`: 12 passed; the run before it, `…-BLOCKED-no-space-on-device.txt`, hit a full
  disk while unpacking the export and read 12 BLOCKED.
- `base-export.proof.ts` + `base-export.config.ts` → `after-ac5-export-build-data.txt`: the export holds exactly the
  two files its own build steps wrote.
- `planted-base/git` (a stand-in `git` that alters the exported tar) → `after-ac5-planted-*.txt`: `fails`,
  `wrote-then-failed`, `missing`, `not-node` and `unnamed` read BLOCKED with the cause; `no-steps` passes.
- `after-ac5-child-cannot-run.txt`: the earlier round's check, repeated: a child that can't load is still BLOCKED.
